#!/usr/bin/env python3
"""데패뉴 프로덕트 공용 데이터 리프레시 스크립트.

노션 REST API에서 실데이터를 끌어와 shared/data/*.json 스냅샷을 갱신한다.
  - pipeline.json   : KR/JP 피드 자동 작성 DB (검수 상태 포함)
  - delegation.json : 위임 트래커
  - news.json       : 최근 완료된 KR 피드 결과 (본문 발췌 포함) — 게임/3D 뉴스룸 소재

사용법: python3 shared/fetch_notion.py
토큰: ~/.openclaw/openclaw.json 안의 Bearer ntn_... 재사용 (직접 REST — MCP 미사용)
레이트리밋 ~3req/s 준수.
"""
import re, json, time, urllib.request, urllib.error, datetime, pathlib, sys

HERE = pathlib.Path(__file__).resolve().parent
DATA = HERE / "data"
DATA.mkdir(exist_ok=True)

KR_FEED_DS = "22feee37-7a48-442a-97c6-359ba1db5a0a"  # 데패뉴 피드 자동 작성
JP_FEED_DS = "5dba4dae-0302-4aae-ba56-52ce362611a0"  # 데패뉴 JP 피드 자동 작성
DELEGATION_DS = "34b7257e-7ced-817b-a201-000be4455ab0"  # 위임 트래커

conf = open(pathlib.Path.home() / ".openclaw/openclaw.json").read()
TOKEN = re.search(r"Bearer (ntn_[A-Za-z0-9]+)", conf).group(1)


def api(path, body=None, retries=3):
    req = urllib.request.Request(
        f"https://api.notion.com/v1{path}",
        data=json.dumps(body).encode() if body is not None else None,
        headers={"Authorization": f"Bearer {TOKEN}", "Notion-Version": "2025-09-03",
                 "Content-Type": "application/json"},
        method="POST" if body is not None else "GET")
    for i in range(retries):
        try:
            with urllib.request.urlopen(req) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code == 429:
                time.sleep(float(e.headers.get("Retry-After", 2)))
                continue
            raise
    raise RuntimeError(f"API failed after {retries} retries: {path}")


def prop_val(p):
    t = p["type"]
    v = p.get(t)
    if v is None:
        return None
    if t in ("title", "rich_text"):
        return "".join(x.get("plain_text", "") for x in v)
    if t in ("select", "status"):
        return v.get("name")
    if t == "multi_select":
        return [x["name"] for x in v]
    if t == "date":
        return v.get("start")
    if t == "people":
        return [x.get("name", "?") for x in v]
    if t in ("url", "checkbox", "number", "created_time", "last_edited_time"):
        return v
    return None


def query_all(ds_id, max_rows=200):
    rows, cursor = [], None
    while len(rows) < max_rows:
        body = {"page_size": min(100, max_rows - len(rows))}
        if cursor:
            body["start_cursor"] = cursor
        r = api(f"/data_sources/{ds_id}/query", body)
        for pg in r["results"]:
            row = {k: prop_val(p) for k, p in pg.get("properties", {}).items()}
            row["_id"] = pg["id"]
            row["_edited"] = pg.get("last_edited_time", "")
            rows.append(row)
        if not r.get("has_more"):
            break
        cursor = r["next_cursor"]
        time.sleep(0.35)
    return rows


def page_excerpt(page_id, max_chars=420):
    """결과 페이지 첫 텍스트 블록들에서 발췌를 뽑는다."""
    try:
        r = api(f"/blocks/{page_id}/children?page_size=15")
    except Exception:
        return ""
    out = []
    for b in r.get("results", []):
        t = b["type"]
        payload = b.get(t, {})
        if isinstance(payload, dict):
            txt = "".join(x.get("plain_text", "") for x in payload.get("rich_text", []))
            if txt.strip():
                out.append(txt.strip())
        if sum(len(x) for x in out) > max_chars:
            break
    text = " ".join(out)
    return text[:max_chars]


def normalize_feed(rows, channel_default):
    items = []
    for r in rows:
        memo = r.get("메모") or r.get("ログ") or ""
        needs_review = "확인필요" in memo or "要確認" in memo
        items.append({
            "id": r["_id"],
            "title": (r.get("제목") or r.get("タイトル") or "").strip(),
            "status": r.get("상태") or r.get("状態"),
            "memo": memo,
            "needs_review": needs_review,
            "requester": (r.get("요청자") or r.get("依頼者") or []),
            "requested_at": r.get("요청일") or r.get("依頼日"),
            "channel": r.get("채널") or channel_default,
            "source": r.get("원본 (글 또는 링크)") or r.get("原本") or "",
            "result_url": r.get("결과 페이지") or r.get("結果ページ"),
            "edited": r["_edited"],
        })
    return items


def main():
    print("KR 피드 요청 조회...")
    kr = normalize_feed(query_all(KR_FEED_DS, 200), "데패뉴")
    print(f"  {len(kr)}건")
    time.sleep(0.35)
    print("JP 피드 요청 조회...")
    jp = normalize_feed(query_all(JP_FEED_DS, 200), "데패뉴JP")
    print(f"  {len(jp)}건")
    time.sleep(0.35)
    print("위임 트래커 조회...")
    dele = query_all(DELEGATION_DS, 100)
    print(f"  {len(dele)}건")

    now = datetime.datetime.now().astimezone().isoformat(timespec="seconds")
    json.dump({"fetched_at": now, "kr": kr, "jp": jp},
              open(DATA / "pipeline.json", "w"), ensure_ascii=False, indent=1)

    delegation = [{
        "id": r["_id"], "title": r.get("제목"), "detail": r.get("상세"),
        "owner": r.get("담당자"), "status": r.get("상태"),
        "priority": r.get("우선순위"), "registered": r.get("등록일"),
        "due": r.get("마감일"), "ceo_checked": r.get("대표 확인"),
        "edited": r["_edited"],
    } for r in dele]
    json.dump({"fetched_at": now, "items": delegation},
              open(DATA / "delegation.json", "w"), ensure_ascii=False, indent=1)

    # 뉴스 소재: 최근 완료 KR 항목 중 제목 있는 것 → 결과 페이지 발췌
    print("뉴스 발췌 수집 (결과 페이지)...")
    news = []
    for it in kr:
        if len(news) >= 24:
            break
        if not it["title"] or not it["result_url"]:
            continue
        m = re.search(r"([0-9a-f]{32})", it["result_url"].replace("-", ""))
        excerpt = ""
        if m:
            pid = m.group(1)
            pid = f"{pid[0:8]}-{pid[8:12]}-{pid[12:16]}-{pid[16:20]}-{pid[20:32]}"
            excerpt = page_excerpt(pid)
            time.sleep(0.35)
        news.append({
            "title": it["title"], "date": (it["requested_at"] or "")[:10],
            "channel": it["channel"], "source": it["source"][:200],
            "excerpt": excerpt, "verified": not it["needs_review"],
        })
        print(f"  + {it['title'][:40]}")
    json.dump({"fetched_at": now, "items": news},
              open(DATA / "news.json", "w"), ensure_ascii=False, indent=1)
    print(f"완료 — pipeline {len(kr)+len(jp)}행 / delegation {len(delegation)}행 / news {len(news)}건")


if __name__ == "__main__":
    sys.exit(main())
