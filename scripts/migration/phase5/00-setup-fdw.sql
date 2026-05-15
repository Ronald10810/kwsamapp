\set ON_ERROR_STOP on

-- Phase 5 promotion setup: create FDW foreign table reference to kwsa_import_staging.migration
-- These foreign tables exist only for the duration of this session
-- After the session ends, they are automatically cleaned up

CREATE EXTENSION IF NOT EXISTS postgres_fdw;

CREATE SERVER IF NOT EXISTS src_staging_server
  FOREIGN DATA WRAPPER postgres_fdw
  OPTIONS (
    dbname 'kwsa_import_staging',
    host 'localhost',
    port '5432'
  );

CREATE USER MAPPING IF NOT EXISTS FOR CURRENT_USER
  SERVER src_staging_server
  OPTIONS (user 'CURRENT_USER');

-- Create schema for foreign tables
CREATE SCHEMA IF NOT EXISTS src_staging;

-- Import foreign table definitions from kwsa_import_staging.migration
IMPORT FOREIGN SCHEMA migration
  FROM SERVER src_staging_server
  INTO src_staging;

-- Verify that the foreign tables are accessible
SELECT 'Foreign table setup check:' AS status;
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'src_staging'
ORDER BY table_name;
