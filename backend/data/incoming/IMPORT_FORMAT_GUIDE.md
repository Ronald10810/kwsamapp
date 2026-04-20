# KWSA Console CSV Import Guide

You do not upload files through the UI.
Place CSV files in this folder, then run one batch command.

## Folder

Use this folder:
- backend/data/incoming

## Required file names

Create these files:
- market-centers.csv
- teams.csv
- associates.csv
- listings.csv

You can also keep your own names and pass them with --market-centers-file, --teams-file, --associates-file, --listings-file.

## Exact CSV headers

### market-centers.csv
market_center_id,name,status,frontdoor_id,updated_at

### teams.csv
team_id,market_center_id,name,status,updated_at

### associates.csv
associate_id,first_name,last_name,email,status,market_center,team,kwuid,updated_at

### listings.csv
listing_id,listing_number,status,market_center,sale_or_rent,street_number,street_name,suburb,city,province,country,price,expiry_date,updated_at

## Date format

- updated_at: ISO timestamp, example 2026-04-01T10:15:00Z
- expiry_date: ISO date, example 2026-09-30

## Run import pipeline

From backend folder:

npm.cmd run data:run:batch -- --batch-prefix 2026-04-17

## If your files have different names

npm.cmd run data:run:batch -- --batch-prefix 2026-04-17 --market-centers-file data/incoming/my-market-centers.csv --teams-file data/incoming/my-teams.csv --associates-file data/incoming/my-associates.csv --listings-file data/incoming/my-listings.csv

## Live results

After the batch completes, start backend and frontend and open:
- Dashboard for pipeline totals
- Listings for loaded listing rows
- Associates for loaded associate rows
