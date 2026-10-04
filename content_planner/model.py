"""อ่านและตรวจไฟล์แผนคลิป (JSON) ตามกฎของทีม"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import date, time

MAX_HOOK_SECONDS = 3
MIN_DURATION = 15
MAX_DURATION = 60
WEEKDAYS = {"mon": 0, "tue": 1, "wed": 2, "thu": 3, "fri": 4, "sat": 5, "sun": 6}


class PlanError(Exception):
    """ไฟล์แผนผิดกฎ เก็บรายการปัญหาทั้งหมดไว้ใน errors"""

    def __init__(self, errors: list[str]):
        super().__init__("\n".join(errors))
        self.errors = errors


@dataclass
class Visit:
    id: str
    date: date
    site: str


@dataclass
class Shot:
    desc: str
    type: str = ""


@dataclass
class Idea:
    id: str
    title: str
    visit: str
    hook: str
    hook_seconds: float
    duration: int
    shots: list[Shot]
    caption: str
    hashtags: list[str]
    post_date: date | None = None


@dataclass
class Plan:
    year: int
    month: int
    post_days: list[int]
    post_time: time
    edit_days: int
    visits: list[Visit]
    ideas: list[Idea]
    default_hashtags: list[str] = field(default_factory=list)

    @property
    def label(self) -> str:
        return f"{self.year:04d}-{self.month:02d}"

    def visit(self, visit_id: str) -> Visit:
        return next(v for v in self.visits if v.id == visit_id)


def normalize_hashtags(tags: list[str]) -> list[str]:
    seen: list[str] = []
    for tag in tags:
        tag = tag.strip().replace(" ", "")
        if not tag:
            continue
        if not tag.startswith("#"):
            tag = "#" + tag
        if tag not in seen:
            seen.append(tag)
    return seen


def load(path: str) -> Plan:
    with open(path, encoding="utf-8") as f:
        return parse(json.load(f))


def parse(data: dict) -> Plan:
    errors: list[str] = []

    try:
        year, month = (int(x) for x in str(data["month"]).split("-"))
        date(year, month, 1)
    except (KeyError, ValueError):
        raise PlanError(['ต้องมี "month" รูปแบบ YYYY-MM เช่น "2026-11"'])

    post_days = []
    for name in data.get("post_days", ["mon", "wed", "fri", "sat"]):
        if name.lower()[:3] not in WEEKDAYS:
            errors.append(f'post_days: ไม่รู้จักวัน "{name}" (ใช้ mon, tue, ... sun)')
        else:
            post_days.append(WEEKDAYS[name.lower()[:3]])
    if not post_days and not errors:
        errors.append("post_days: ต้องมีวันโพสต์อย่างน้อย 1 วัน")

    try:
        post_time = time.fromisoformat(data.get("post_time", "19:00"))
    except ValueError:
        errors.append('post_time: ใช้รูปแบบ HH:MM เช่น "19:00"')
        post_time = time(19, 0)

    edit_days = int(data.get("edit_days", 1))

    visits = []
    for i, v in enumerate(data.get("visits", []), 1):
        try:
            visits.append(Visit(id=v["id"], date=date.fromisoformat(v["date"]), site=v.get("site", "")))
        except (KeyError, ValueError):
            errors.append(f"visits[{i}]: ต้องมี id และ date (YYYY-MM-DD)")
    if not visits:
        errors.append("ต้องมีการลงพื้นที่ (visits) อย่างน้อย 1 ครั้ง")
    elif len(visits) > 3:
        errors.append(f"ลงพื้นที่ {len(visits)} ครั้ง เกินเป้า 1-3 ครั้งต่อเดือน")
    visit_ids = {v.id for v in visits}

    ideas = []
    for i, raw in enumerate(data.get("ideas", []), 1):
        idea_id = raw.get("id") or f"C{i:02d}"
        where = f"คลิป {idea_id}"
        hook = raw.get("hook") or {}
        if isinstance(hook, str):
            hook = {"text": hook}
        hook_text = (hook.get("text") or "").strip()
        hook_seconds = float(hook.get("seconds", MAX_HOOK_SECONDS))
        duration = int(raw.get("duration", 0))
        shots = [Shot(s) if isinstance(s, str) else Shot(s.get("desc", ""), s.get("type", ""))
                 for s in raw.get("shots", [])]
        caption = (raw.get("caption") or "").strip()
        hashtags = normalize_hashtags(raw.get("hashtags", []) + data.get("default_hashtags", []))

        if not raw.get("title"):
            errors.append(f"{where}: ไม่มีชื่อ (title)")
        if raw.get("visit") not in visit_ids:
            errors.append(f'{where}: visit "{raw.get("visit")}" ไม่ตรงกับการลงพื้นที่ใดเลย')
        if not hook_text:
            errors.append(f"{where}: ไม่มี hook 3 วินาทีแรก")
        if hook_seconds > MAX_HOOK_SECONDS:
            errors.append(f"{where}: hook ยาว {hook_seconds:g} วิ เกิน {MAX_HOOK_SECONDS} วิ")
        if not MIN_DURATION <= duration <= MAX_DURATION:
            errors.append(f"{where}: ความยาว {duration} วิ ต้องอยู่ระหว่าง {MIN_DURATION}-{MAX_DURATION} วิ")
        if not shots or any(not s.desc.strip() for s in shots):
            errors.append(f"{where}: shot list ว่างหรือมีช็อตที่ไม่มีคำอธิบาย")
        if not caption:
            errors.append(f"{where}: ไม่มีแคปชั่น")
        if not hashtags:
            errors.append(f"{where}: ไม่มีแฮชแท็ก")

        ideas.append(Idea(
            id=idea_id, title=raw.get("title", ""), visit=raw.get("visit", ""),
            hook=hook_text, hook_seconds=hook_seconds, duration=duration,
            shots=shots, caption=caption, hashtags=hashtags,
        ))
    if not ideas:
        errors.append("ต้องมีไอเดียคลิป (ideas) อย่างน้อย 1 คลิป")
    dup = sorted({x.id for x in ideas if [y.id for y in ideas].count(x.id) > 1})
    if dup:
        errors.append(f"id คลิปซ้ำกัน: {', '.join(dup)}")

    if errors:
        raise PlanError(errors)
    return Plan(year, month, sorted(set(post_days)), post_time, edit_days, visits, ideas,
                normalize_hashtags(data.get("default_hashtags", [])))
