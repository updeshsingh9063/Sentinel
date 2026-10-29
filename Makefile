.PHONY: help setup data cohort api web test lint db-reset up down

help:
	@echo "setup      install backend, model and frontend dependencies"
	@echo "data       fetch external reference datasets (~7 MB)"
	@echo "data-full  also fetch SisFall + UCI HAR (~300 MB, P2)"
	@echo "cohort     generate the synthetic senior cohort"
	@echo "api        run the FastAPI server on :8000"
	@echo "web        run the Next.js dev server on :3000"
	@echo "test       run backend and model test suites"
	@echo "lint       ruff + tsc"
	@echo "up / down  docker compose"

setup:
	python -m pip install -r backend/requirements.txt
	python -m pip install -r model/requirements.txt
	cd frontend && npm install

data:
	python scripts/fetch_datasets.py

data-full:
	python scripts/fetch_datasets.py --with-activity

cohort:
	python scripts/generate_cohort.py --seniors 200 --days 90

api:
	cd backend && python -m uvicorn app.main:app --reload --port 8000

web:
	cd frontend && npm run dev

# WARNING: never run this while `make web` is running. Both use frontend/.next,
# and a production build overwrites the dev server chunks -- the page then
# renders with no CSS and no JS because every /_next/static/* request 404s.
# Stop the dev server first, or build in a separate checkout.
web-build:
	cd frontend && npm run build

test:
	cd backend && python -m pytest -q
	cd model && python -m pytest -q

lint:
	python -m ruff check backend model scripts
	cd frontend && npx tsc --noEmit

up:
	docker compose up --build

down:
	docker compose down
