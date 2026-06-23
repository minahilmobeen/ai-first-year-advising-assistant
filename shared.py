"""
Shared utilities used by both the notebook (advising_assistant.ipynb) and the web app (main.py).
Import from this module to avoid duplicating logic across both files.
"""

from __future__ import annotations

import re as _re
import numpy as np
import pandas as pd


# ── Constants ─────────────────────────────────────────────────────────────────

VALID_GENED_ATTRS = {
    "AISO", "AIHS", "AISR", "AILT", "AIVP", "AINS",
    "IFPE", "IFWC", "IFEB", "IFQD", "SLP",
}


# ── 1. Course description builder ─────────────────────────────────────────────
# Duplicated as `_build_full_desc` (notebook) and `_build_desc` (main.py).

def build_course_desc(row: pd.Series) -> str:
    """
    Concatenate COURSE_DESC and COURSE_PREREQS into a single description string.
    If either field is empty/NaN the original description is returned unchanged.
    """
    desc   = row["COURSE_DESC"]
    prereq = row["COURSE_PREREQS"]

    if pd.isna(desc) or str(desc).strip() == "":
        return desc
    if pd.isna(prereq) or str(prereq).strip() == "":
        return desc

    prereq_clean = _re.sub(r"\s+", " ", str(prereq)).strip()
    if not prereq_clean:
        return desc

    return f"{str(desc).strip().rstrip('.')}.\nPrerequisite Information: {prereq_clean}."


# ── 2. Registration CSV → gen-ed pivot ────────────────────────────────────────
# Duplicated as inline cell logic (notebook) and inside `_build_rec_data` (main.py).

def build_gened_pivot(reg_df: pd.DataFrame) -> pd.DataFrame:
    """
    Given the raw registration DataFrame (with ATTR and CRN columns), filter to
    valid gen-ed attribute codes, pivot so each CRN gets ATTR 1 / ATTR 2 columns,
    and return the result.
    """
    dfGE = reg_df.copy()
    dfGE["ATTR"] = np.where(dfGE["ATTR"].isin(VALID_GENED_ATTRS), dfGE["ATTR"], "")
    dfGE = dfGE[dfGE["ATTR"] != ""]

    dfGEI = dfGE[["CRN", "ATTR"]].drop_duplicates()
    dfGEI["_attr_rank"] = dfGEI.groupby("CRN", dropna=False).cumcount() + 1
    dfGE = (
        dfGEI.pivot(index="CRN", columns="_attr_rank", values="ATTR")
        .reset_index()
        .fillna("")
    )
    dfGE = dfGE.rename(columns={1: "ATTR 1", 2: "ATTR 2"})
    return dfGE


# ── 3. Full registration cleanup pipeline ─────────────────────────────────────
# Duplicated as inline cell logic (notebook) and inside `_build_rec_data` (main.py).

def build_clean_registration(reg_csv_path: str) -> tuple[pd.DataFrame, pd.DataFrame]:
    """
    Load the registration CSV, apply the gen-ed pivot, concatenate prereqs into
    descriptions, and return:
      - dfNew  : CRN-level DataFrame with ATTR 1, ATTR 2, and merged COURSE_DESC
      - dfFinal: deduplicated course-level DataFrame (SUBJ, CRSE, TITLE, COURSE_DESC, ATTR 1, ATTR 2)
    """
    reg_df = pd.read_csv(reg_csv_path)
    gened_pivot = build_gened_pivot(reg_df)

    dfNew = reg_df.drop(columns="ATTR").drop_duplicates().reset_index(drop=True)
    dfNew = pd.merge(dfNew, gened_pivot, how="left", on="CRN")
    dfNew["ATTR 1"] = dfNew["ATTR 1"].fillna("")
    dfNew["ATTR 2"] = dfNew["ATTR 2"].fillna("")
    dfNew["COURSE_DESC"] = dfNew.apply(build_course_desc, axis=1)

    dfFinal = dfNew[
        ["SUBJ", "CRSE", "TITLE", "COURSE_DESC", "ATTR 1", "ATTR 2"]
    ].drop_duplicates()

    return dfNew, dfFinal


# ── 4. Major entry-courses lookup builder ─────────────────────────────────────
# Duplicated as inline cell logic (notebook) and inside `_build_rec_data` (main.py).

def build_major_courses_lookup(major_courses_df: pd.DataFrame) -> dict:
    """
    Build a dict mapping major name → {level, additional_notes, courses:[...]}.
    Expects columns: major, level, additional_notes,
                     first_course_code, first_course_title, gen_ed,
                     next_course, next_course_title, next_course_gened.
    """
    lookup: dict = {}
    for _, row in major_courses_df.iterrows():
        major_name = row["major"]
        if major_name not in lookup:
            lookup[major_name] = {
                "level":            row["level"],
                "additional_notes": row["additional_notes"] if pd.notna(row["additional_notes"]) else None,
                "courses": [],
            }
        if pd.notna(row["first_course_code"]) and pd.notna(row["first_course_title"]):
            lookup[major_name]["courses"].append({
                "code":   row["first_course_code"],
                "name":   row["first_course_title"],
                "gen_ed": row["gen_ed"] if pd.notna(row["gen_ed"]) else None,
            })
        if pd.notna(row["next_course"]) and pd.notna(row["next_course_title"]):
            lookup[major_name]["courses"].append({
                "code":   row["next_course"],
                "name":   row["next_course_title"],
                "gen_ed": row["next_course_gened"] if pd.notna(row["next_course_gened"]) else None,
            })
    return lookup


# ── 5. Student profile → string ───────────────────────────────────────────────
# Duplicated as `student_profile_to_str` (notebook) and inline in `/api/regen` (main.py).

def student_profile_to_str(row: pd.Series) -> str:
    """
    Convert a student survey row (or dict-like) into the free-form profile
    string expected by the LLM prompt.
    """
    return f"""
    Academic Interest 1: {row['Academic Interest 1']}
    Academic Interest 2: {row['Academic Interest 2']}

    Recreation/ Hobbies: {row['Recreation Hobbies']}
    Employment: {row['Employment Service']}

    Interest 1: {row['Interest 1']}
    Interest 2: {row['Interest 2']}
    Interest 3: {row['Interest 3']}
    Interest 4: {row['Interest 4']}
    Interest 5: {row['Interest 5']}
    """

# ── 6. First-year course merge pipeline ───────────────────────────────────────────────
def build_fy_details(
    fy_excel_path: str,
    dfN: pd.DataFrame,
    dfF: pd.DataFrame,
) -> pd.DataFrame:
    """
    Load the first-year course Excel sheet, merge in course descriptions and
    gen-ed attributes from the cleaned registration data, and return a
    deduplicated fy_details DataFrame.
    """
    fy_xl  = pd.read_excel(fy_excel_path)
    crn_lk = (dfN[["CRN", "COURSE_DESC", "ATTR 1", "ATTR 2"]]
              .drop_duplicates(subset=["CRN"]).copy())
    crn_lk["CRN"] = crn_lk["CRN"].astype(int)

    fy_w  = fy_xl[fy_xl["CRN"].notna()].copy()
    fy_wo = fy_xl[fy_xl["CRN"].isna()].copy()

    fy_w = (fy_w.assign(_c=fy_w["CRN"].astype(int))
            .merge(crn_lk.rename(columns={"CRN": "_c"}), on="_c", how="left")
            .drop(columns=["_c"]))
    fy_wo = fy_wo.merge(
        dfF[["SUBJ", "CRSE", "TITLE", "COURSE_DESC", "ATTR 1", "ATTR 2"]],
        on=["SUBJ", "CRSE", "TITLE"], how="left"
    )

    mm = fy_wo["COURSE_DESC"].isna() & ~fy_wo["TITLE"].astype(str).str.startswith("ST:")
    if mm.any():
        fb = (dfF[["SUBJ", "CRSE", "COURSE_DESC", "ATTR 1", "ATTR 2"]]
              .dropna(subset=["COURSE_DESC"])
              .groupby(["SUBJ", "CRSE"], as_index=False).first())
        ffb = fy_wo.loc[mm, ["SUBJ", "CRSE"]].merge(fb, on=["SUBJ", "CRSE"], how="left")
        fy_wo.loc[mm, "COURSE_DESC"] = ffb["COURSE_DESC"].values
        fy_wo.loc[mm, "ATTR 1"]      = ffb["ATTR 1"].values
        fy_wo.loc[mm, "ATTR 2"]      = ffb["ATTR 2"].values

    fy_det = (pd.concat([fy_w, fy_wo], ignore_index=True)
              .drop(columns=["CRN"], errors="ignore")
              .drop_duplicates(subset=["SUBJ", "CRSE", "TITLE"])
              .reset_index(drop=True))

    stm = fy_det["COURSE_DESC"].isna() & fy_det["TITLE"].astype(str).str.startswith("ST:")
    fy_det.loc[stm, "COURSE_DESC"] = "Special Topics course. Description can be found on website."

    # Append cross-listing notes for courses that share a title across different subjects.
    # Same subject + different course number sharing a title (e.g. ARAB 101/102) is not
    # treated as cross-listing — only different subjects qualify.
    title_subj_counts = fy_det.groupby("TITLE")["SUBJ"].nunique()
    cross_listed_titles = title_subj_counts[title_subj_counts > 1].index

    for title in cross_listed_titles:
        mask = fy_det["TITLE"] == title
        entries = list(fy_det.loc[mask, ["SUBJ", "CRSE"]].itertuples(index=False, name=None))
        for idx in fy_det.index[mask]:
            subj = fy_det.at[idx, "SUBJ"]
            crse = str(fy_det.at[idx, "CRSE"])
            others = [f"{s} {c}" for s, c in entries if not (s == subj and str(c) == crse)]
            if others:
                note = f"Cross-listed with {', '.join(others)}."
                desc = fy_det.at[idx, "COURSE_DESC"]
                if pd.isna(desc) or str(desc).strip() == "":
                    fy_det.at[idx, "COURSE_DESC"] = note
                else:
                    fy_det.at[idx, "COURSE_DESC"] = str(desc).rstrip(".") + " " + note

    return fy_det


# ── 7. Match course titles to descriptions ───────────────────────────────────────────────
def build_course_title_info(fy_details: pd.DataFrame) -> dict:
    """
    Build a dict mapping uppercase course title → {desc, geneds}.
    Used to enrich recommendation results with descriptions and gen-ed codes.
    """
    info = {}
    for _, r in fy_details.iterrows():
        key = str(r["TITLE"]).upper().strip()
        if key not in info:
            gs = [g for g in [
                str(r["ATTR 1"]).strip() if pd.notna(r["ATTR 1"]) else "",
                str(r["ATTR 2"]).strip() if pd.notna(r["ATTR 2"]) else "",
            ] if g]
            info[key] = {
                "desc":   r["COURSE_DESC"] if pd.notna(r["COURSE_DESC"]) else "",
                "geneds": gs,
            }
    return info