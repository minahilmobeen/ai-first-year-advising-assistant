from __future__ import annotations

# Importing functions from shared.py file 
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from shared import (
    build_clean_registration,
    build_major_courses_lookup,
    student_profile_to_str,
    build_fy_details, 
    build_course_title_info
)

# Load packages
from fastapi import FastAPI, Request, HTTPException
from fastapi.templating import Jinja2Templates
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from typing import Optional, Any
from openai import OpenAI

import json
import pandas as pd
import uuid

from sqlalchemy import String, create_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column
from sqlalchemy.types import JSON

app = FastAPI()
app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")

# ── Student store ─────────────────────────────────────────────────────────────
with open("student_store.json") as f:
    student_store = json.load(f)

# SQL Database Definitions
class Base(DeclarativeBase):
    pass

class StudentAdvisingRec(Base):
    __tablename__ = "student_advising_rec"

    id: Mapped[str] = mapped_column(
        String,
        primary_key=True,
        default=lambda: str(uuid.uuid4()),
    )

    raw_id: Mapped[str] = mapped_column(
        String,
        nullable=False,
    )

    data: Mapped[dict[str, Any]] = mapped_column(
        JSON,
        nullable=False,
    )

DB_URL = "sqlite:///" + os.path.join(os.path.dirname(__file__), "..", "student_rec_data.db")
engine = create_engine(DB_URL, echo=False)

def get_item(item_id: str) -> dict[str, Any] | None:
    with Session(engine) as session:
        item = session.get(StudentAdvisingRec, item_id)

        if item is None:
            return "Missing"

        return {
            "id": item.id,
            "raw_id": item.raw_id,
            "data": item.data,
        }


# ── Load recommendation data once at startup ──────────────────────────────────
def _build_rec_data():
    major_df = pd.read_excel(f"{DATA_DIR}/firstyearadvising.xlsx", sheet_name="majors_list")
    fys_df   = pd.read_excel(f"{DATA_DIR}/fys.xlsx")
    gened_df = pd.read_excel(f"{DATA_DIR}/gened.xlsx")

    # Major entry-courses lookup
    mc_df = pd.read_excel(f"{DATA_DIR}/firstyearadvising.xlsx", sheet_name="major_entry_courses")
    major_courses_lookup = build_major_courses_lookup(mc_df)

    fys_desc_lookup   = dict(zip(fys_df["Course Name"], fys_df["Description"]))
    gened_desc_lookup = dict(zip(gened_df["Gen Ed Name"], gened_df["Description"]))

    # Registration CSV → gen-ed attributes per course
    dfN, dfF = build_clean_registration(f"{DATA_DIR}/sample_fall2026_courses.csv")

    fy_det = build_fy_details(f"{DATA_DIR}/sample_fy_courses.xlsx", dfN, dfF)

    course_info = build_course_title_info(fy_det)

    gc_df = fy_det[
        (fy_det["ATTR 1"].notna() & (fy_det["ATTR 1"].str.strip() != "")) |
        (fy_det["ATTR 2"].notna() & (fy_det["ATTR 2"].str.strip() != ""))
    ].copy()

    # Dropdown option lists
    ai_df = pd.read_excel(f"{DATA_DIR}/firstyearadvising.xlsx", sheet_name="academic_interests")
    oi_df = pd.read_excel(f"{DATA_DIR}/firstyearadvising.xlsx", sheet_name="other_interests")
    academic_options = ai_df["academic_interests"].dropna().tolist()
    other_options    = oi_df["other_interests"].dropna().tolist()

    return {
        "major_names":        major_df["major"].tolist(),
        "major_descs":        major_df["description"].fillna("").tolist(),
        "major_desc_lookup":  dict(zip(major_df["major"], major_df["description"].fillna(""))),
        "fys_names":         fys_df["Course Name"].tolist(),
        "fys_descs":         fys_df["Description"].tolist(),
        "gened_names":       gened_df["Gen Ed Name"].tolist(),
        "gened_descs":       gened_df["Description"].tolist(),
        "gc_names":          gc_df["TITLE"].tolist(),
        "gc_descs":          gc_df["COURSE_DESC"].fillna("").tolist(),
        "major_courses":     major_courses_lookup,
        "fys_lookup":        fys_desc_lookup,
        "gened_lookup":      gened_desc_lookup,
        "course_info":       course_info,
        "academic_options":  academic_options,
        "other_options":     other_options,
    }

_REC = _build_rec_data()


# ── OpenAI client ───────────────────────────
from dotenv import load_dotenv
load_dotenv()

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
client = OpenAI(api_key=OPENAI_API_KEY)


# ── Pydantic models for OpenAI structured output ──────────────────────────────
class OptionChoice(BaseModel):
    reasons:       str = Field(description="1–3 sentences explaining why this option fits the student.")
    rank:          int = Field(description="Rank of this recommendation among all recommended options, where 1 = strongest fit.")
    option_number: int = Field(description="The option number from the provided list.")
    option_name:   str = Field(description="The option name exactly as it appears in the list.")

class MajorOptionChoice(OptionChoice):
    suggested_concentration: Optional[str] = Field(
        default=None,
        description="If the major's description lists possible concentrations, the single concentration "
                    "name (without bullet points or leading symbols) that best fits this student's profile. "
                    "Return only the plain name, e.g. 'Marketing' not '• Marketing'. "
                    "Leave null if the major has no concentrations.",
    )

class RecommendationSet(BaseModel):
    thought_process:     str              = Field(description="Reasoning behind the recommendations.")
    recommended_options: list[OptionChoice]

class MajorRecommendationSet(BaseModel):
    thought_process:     str                   = Field(description="Reasoning behind the recommendations.")
    recommended_options: list[MajorOptionChoice]


def _regen_recommendations(profile_str: str) -> dict:
    def call(names, descs, category, n, additional_rules="", output_model=RecommendationSet):
        extra = f"\n{additional_rules.strip()}" if additional_rules.strip() else ""
        sys_prompt = f"""You are an academic advising assistant supporting a university professor.
You will be provided with a student profile and a numbered list of available {category}.
Your task is to recommend {n} strong candidate options that may be valuable for the advisor to discuss with the student.

PII includes: name, gender, pronouns, race/ethnicity, nationality, religion, specific employer details, or any information that could identify an individual. Academic interests, hobbies, and general goals are NOT considered PII.

Rules:
- Only recommend options that appear in the provided list.
- Base recommendations solely on academic interests, hobbies, goals, and preferences.
- Never reference or repeat any PII in your output.
- For each recommendation, provide 1-3 concise sentences explaining why it is a strong fit.
- Reasons must be distinct and specific to the student's profile (no PII).{extra}"""

        opts_str = "\n".join(
            f"Option #{i+1}\nOption Name: {nm}\nOption Description: {ds}\n"
            for i, (nm, ds) in enumerate(zip(names, descs))
        )
        response = client.responses.parse(   # type: ignore[union-attr]
            model="gpt-5.4-nano",
            input=[
                {"role": "system", "content": sys_prompt},
                {"role": "user",   "content": f"Student Profile:\n{profile_str}\n\nAvailable {category}:\n{opts_str}"},
            ],
            text_format=output_model,
        )
        return response.output_parsed

    def _parse_concentrations(desc: str) -> list[str]:
        if "Possible concentrations offered" not in desc:
            return []
        concs = []
        for line in desc.split("\n")[1:]:
            name = line.strip().lstrip("•").replace("\xa0", " ").strip()
            if name:
                concs.append(name)
        return concs

    _MAJOR_EXTRA = (
        "- Do NOT recommend the same major more than once.\n"
        "- If a major's description lists possible concentrations, populate the "
        "suggested_concentration field with the single concentration from that list that best "
        "fits the student's profile (copy the name exactly as listed). If the major has no "
        "concentrations, leave suggested_concentration null.\n"
        "- Rank the 10 recommendations from strongest fit (rank 1) to weakest fit (rank 10), "
        "and list them in that order."
    )
    major_recs = call(
        _REC["major_names"], _REC["major_descs"],
        "Academic Programs, including Majors, Minors, and Concentrations", 10, _MAJOR_EXTRA,
        output_model=MajorRecommendationSet,
    )
    fys_recs    = call(_REC["fys_names"],   _REC["fys_descs"],
                       "First-Year Seminar Courses", 25)
    gened_recs  = call(_REC["gened_names"], _REC["gened_descs"],
                       "General Education Requirements", 5)
    course_recs = call(_REC["gc_names"],    _REC["gc_descs"],
                       "Gen-Ed Fulfilling Courses Available to First-Year Students", 20)

    def s_major(opt):
        lk   = _REC["major_courses"].get(opt.option_name, {})
        desc = _REC["major_desc_lookup"].get(opt.option_name, "")
        concentrations = _parse_concentrations(desc)
        suggested = getattr(opt, "suggested_concentration", None)
        if suggested:
            normalized = suggested.strip().lstrip("•").replace("\xa0", " ").strip()
            if normalized in concentrations:
                suggested = normalized
            else:
                suggested = None
        return {
            "option_name":              opt.option_name,
            "option_number":            opt.option_number,
            "rank":                     opt.rank,
            "reasons":                  opt.reasons,
            "level":                    lk.get("level"),
            "additional_notes":         lk.get("additional_notes"),
            "courses":                  lk.get("courses", []),
            "concentrations":           concentrations,
            "suggested_concentration":  suggested,
        }

    def s_fys(opt):
        return {
            "option_name":   opt.option_name,
            "option_number": opt.option_number,
            "reasons":       opt.reasons,
            "description":   _REC["fys_lookup"].get(opt.option_name, ""),
        }

    def s_gened(opt):
        return {
            "option_name":   opt.option_name,
            "option_number": opt.option_number,
            "reasons":       opt.reasons,
            "description":   _REC["gened_lookup"].get(opt.option_name, ""),
        }

    def s_course(opt):
        info = _REC["course_info"].get(opt.option_name.upper().strip(), {})
        return {
            "option_name":   opt.option_name,
            "option_number": opt.option_number,
            "reasons":       opt.reasons,
            "description":   info.get("desc", ""),
            "geneds":        info.get("geneds", []),
        }

    seen_majors: set[str] = set()
    unique_majors = []
    for o in major_recs.recommended_options:
        key = o.option_name.strip().lower()
        if key not in seen_majors:
            seen_majors.add(key)
            unique_majors.append(s_major(o))

    return {
        "majors":       unique_majors,
        "fys":          [s_fys(o)    for o in fys_recs.recommended_options],
        "genedAreas":   [s_gened(o)  for o in gened_recs.recommended_options],
        "genedCourses": [s_course(o) for o in course_recs.recommended_options],
    }


# ── Request model ─────────────────────────────────────────────────────────────
class RegenRequest(BaseModel):
    id:                int | str
    academicInterests: list[str]
    topInterests:      list[str]
    recreation:        str
    employment:        str
    additionalInfo:    str = ""


# ── Routes ────────────────────────────────────────────────────────────────────
@app.get("/")
def home(request: Request, id: Optional[str] = None):
    student = None
    if id:
        # data = student_store.get(id)
        sql_entry = get_item(item_id=str(id))
        if sql_entry != "Missing":
            data = sql_entry["data"]
            student = dict(data)
            student["fy_courses"] = student_store.get("_catalog", {}).get("fy_courses", [])

    options = {
        "academicInterests": _REC["academic_options"],
        "otherInterests":    _REC["other_options"],
    }
    return templates.TemplateResponse(request, "index.html", {
        "student": student,
        "options": options,
    })


@app.post("/api/regen")
def regen(body: RegenRequest):
    if not client:
        raise HTTPException(
            status_code=503,
            detail="OPENAI_API_KEY environment variable is not set. Cannot regenerate recommendations.",
        )

    ai_1 = body.academicInterests[0] if len(body.academicInterests) > 0 else ""
    ai_2 = body.academicInterests[1] if len(body.academicInterests) > 1 else ""
   
    profile_str = student_profile_to_str({
        "Academic Interest 1": ai_1,
        "Academic Interest 2": ai_2,
        "Recreation Hobbies":  body.recreation,
        "Employment Service":  body.employment,
        "Interest 1": body.topInterests[0] if len(body.topInterests) > 0 else "",
        "Interest 2": body.topInterests[1] if len(body.topInterests) > 1 else "",
        "Interest 3": body.topInterests[2] if len(body.topInterests) > 2 else "",
        "Interest 4": body.topInterests[3] if len(body.topInterests) > 3 else "",
        "Interest 5": body.topInterests[4] if len(body.topInterests) > 4 else "",
    })
    if body.additionalInfo.strip():
        profile_str += f"\n    Additional Information: {body.additionalInfo.strip()}"

    try:
        recommendations = _regen_recommendations(profile_str)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    return JSONResponse(content={"recommendations": recommendations})
