"""เขียนแผนออกเป็น Markdown (ไว้อ่าน/พกไปหน้างาน) และ CSV (ไว้ลงตารางโพสต์)"""

from __future__ import annotations

import csv
import io

from .model import Plan

THAI_DAYS = ["จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส.", "อา."]


def _day(d) -> str:
    return f"{THAI_DAYS[d.weekday()]} {d.isoformat()}"


def markdown(plan: Plan) -> str:
    out = [f"# แผนคลิป TikTok เดือน {plan.label}", ""]
    out.append(f"ลงพื้นที่ {len(plan.visits)} ครั้ง ได้ {len(plan.ideas)} คลิป · "
               f"โพสต์เวลา {plan.post_time:%H:%M} · ตัดต่อแนวตั้ง 9:16 ยาว 15-60 วิ ใส่ซับไทย")
    out.append("")

    out += ["## Shot list รวมต่อการลงพื้นที่", ""]
    for visit in sorted(plan.visits, key=lambda v: v.date):
        clips = [i for i in plan.ideas if i.visit == visit.id]
        out.append(f"### {_day(visit.date)} · {visit.site or visit.id} ({len(clips)} คลิป)")
        out.append("")
        for idea in clips:
            out.append(f"- [ ] **{idea.id}** hook: {idea.hook}")
            for shot in idea.shots:
                kind = f" _({shot.type})_" if shot.type else ""
                out.append(f"- [ ] **{idea.id}** {shot.desc}{kind}")
        out.append("")

    out += ["## รายละเอียดแต่ละคลิป", ""]
    for idea in sorted(plan.ideas, key=lambda i: i.post_date or plan.visit(i.visit).date):
        out.append(f"### {idea.id} · {idea.title}")
        out.append("")
        if idea.post_date:
            out.append(f"- โพสต์: {_day(idea.post_date)} {plan.post_time:%H:%M}")
        out.append(f"- ความยาว: {idea.duration} วิ")
        out.append(f"- Hook ({idea.hook_seconds:g} วิแรก): {idea.hook}")
        out.append("- Shot list:")
        for n, shot in enumerate(idea.shots, 1):
            kind = f" ({shot.type})" if shot.type else ""
            out.append(f"  {n}. {shot.desc}{kind}")
        out.append(f"- แคปชั่น: {idea.caption}")
        out.append(f"- แฮชแท็ก: {' '.join(idea.hashtags)}")
        out.append("")

    out += ["## ตารางโพสต์", "", "| วันที่ | เวลา | คลิป | ชื่อ |", "|---|---|---|---|"]
    for idea in sorted((i for i in plan.ideas if i.post_date), key=lambda i: i.post_date):
        out.append(f"| {_day(idea.post_date)} | {plan.post_time:%H:%M} | {idea.id} | {idea.title} |")
    out.append("")
    return "\n".join(out)


def schedule_csv(plan: Plan) -> str:
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\n")
    w.writerow(["date", "time", "clip", "title", "duration", "caption", "hashtags", "visit_date", "site"])
    for idea in sorted((i for i in plan.ideas if i.post_date), key=lambda i: i.post_date):
        visit = plan.visit(idea.visit)
        w.writerow([idea.post_date.isoformat(), f"{plan.post_time:%H:%M}", idea.id, idea.title,
                    idea.duration, idea.caption, " ".join(idea.hashtags),
                    visit.date.isoformat(), visit.site])
    return buf.getvalue()
