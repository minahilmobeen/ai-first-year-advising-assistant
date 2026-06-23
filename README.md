# AI First-Year Advising Assistant

## Overview

The AI First-Year Advising Assistant is an advisor-facing web application that helps generate personalized academic recommendations for first-year students.

The system uses structured student profile information and large language models to recommend:

* Academic programs (majors, minors, and concentrations)
* First-Year Seminar (FYS) courses
* General Education (Gen Ed) pathways
* First-year courses aligned with recommended programs and Gen Ed requirements

The project was developed as part of a faculty-led research initiative exploring how generative AI can support academic advising workflows. While the project originated from faculty research, the system design, implementation, recommendation pipeline, web application, and data processing workflows were independently developed by the author.

---

## Motivation

Academic advisors often support large numbers of students with diverse interests, goals, and academic backgrounds. Identifying relevant programs, seminars, and courses can require significant time and institutional knowledge.

This project explores how generative AI can assist advisors by quickly surfacing relevant academic opportunities while preserving advisor oversight and decision-making.

Rather than replacing advisors, the system is designed to function as a decision-support tool that helps advisors identify options worth discussing with students.

---

## Key Features

### AI-Powered Academic Program Recommendations

Generates personalized recommendations for:

* Majors
* Minors
* Concentrations

based on student interests, activities, goals, and preferences.

### First-Year Seminar Recommendations

Suggests relevant First-Year Seminar (FYS) courses aligned with student interests and academic goals.

### General Education Recommendations

Recommends Gen Ed pathways and courses that may be particularly valuable for a student's interests and future academic plans.

### Course Recommendation Support

For recommended academic programs and Gen Ed areas, the system also identifies relevant first-year courses that students can consider when planning their schedules.

### Advisor-Facing Interface

Provides a simple web interface that allows advisors to:

* Review student information
* Generate recommendations
* Select recommendations for sharing
* Generate advisor-ready recommendation summaries

### Privacy-Oriented Design

To reduce exposure of student information:

* Student profiles are not searchable through the public interface
* Students can access recommendations through unique identifiers or recommendation generation workflows
* Recommendations are not permanently stored through the web interface
* The public repository contains only demonstration and public data

---

## Technologies Used

### Backend

* Python
* FastAPI
* SQLAlchemy

### AI and Recommendation Pipeline

* OpenAI API
* Structured LLM outputs
* Prompt engineering
* Recommendation ranking workflows

### Data Processing

* Pandas
* NumPy
* Excel and CSV processing pipelines

### Frontend

* HTML
* CSS
* JavaScript
* Jinja2 templating

### Development Environment

* Jupyter Notebook
* VS Code

---

## Recommendation Workflow

1. Student profile information is collected.
2. Profile data is converted into a structured prompt.
3. The recommendation engine evaluates:

   * Academic programs
   * First-Year Seminars
   * Gen Ed pathways
   * First-year courses
4. Recommendations are ranked and enriched with supporting information.
5. Advisors review and select recommendations.
6. Recommendation summaries can be copied into advisor communications.

---

## Repository Structure

```text
project/
├── main.py
├── templates/
│   └── index.html
├── static/
│   ├── apps.js
│   └── styles.css
├── student_store.json

shared.py

firstyearadvising.xlsx
fys.xlsx
gened.xlsx

sample_student_data.csv
sample_fall2026_courses.csv
sample_fy_courses.xlsx

advising_assistant.ipynb
```

---

## Running the Project

### Install Dependencies

```bash
pip install -r requirements.txt
```

### Create Environment Variables

Create a `.env` file:

```text
OPENAI_API_KEY=your_api_key_here
```

### Start the Application

```bash
cd project
python -m uvicorn main:app --reload
```

Open:

```text
http://127.0.0.1:8000
```

in your browser.

---

## Data and Privacy

This repository contains only public or demonstration data.

The repository does not contain:

* Personally identifiable student information
* Advisor notes
* Private institutional records
* API keys

Any student-related data included in this repository is synthetic and exists solely to demonstrate system functionality.

---

## Future Improvements

Potential future enhancements include:

* Advisor authentication and role-based access controls
* Improved recommendation explainability
* Recommendation feedback loops
* Expanded academic planning support
* Integration with institutional advising systems
* Evaluation studies measuring advising effectiveness and recommendation quality
* Support for transfer students and alternative academic pathways

---

## Research Context

This project was developed as part of a faculty-led research effort exploring the application of generative AI to higher education advising.

The work investigates how AI systems can support academic decision-making, improve information discovery, and assist advisors while maintaining human oversight in the advising process.

---

## License

This repository is provided for educational and research purposes.
