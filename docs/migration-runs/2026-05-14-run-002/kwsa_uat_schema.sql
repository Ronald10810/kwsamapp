--
-- PostgreSQL database dump
--

\restrict E1owFvhhGgXPmWaeI0Lv1cd362sfC3SkmBPg5I8wxj39XrdY57Ng87mG6copcV8

-- Dumped from database version 18.3
-- Dumped by pg_dump version 18.3 (Debian 18.3-1.pgdg13+1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: app; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA app;


--
-- Name: google_vacuum_mgmt; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA google_vacuum_mgmt;


--
-- Name: migration; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA migration;


--
-- Name: staging; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA staging;


--
-- Name: google_vacuum_mgmt; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS google_vacuum_mgmt WITH SCHEMA google_vacuum_mgmt;


--
-- Name: EXTENSION google_vacuum_mgmt; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION google_vacuum_mgmt IS 'extension for assistive operational tooling';


--
-- Name: pg_trgm; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;


--
-- Name: EXTENSION pg_trgm; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pg_trgm IS 'text similarity measurement and index searching based on trigrams';


--
-- Name: ListingStatusEnum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."ListingStatusEnum" AS ENUM (
    'ACTIVE',
    'INACTIVE',
    'SOLD',
    'WITHDRAWN',
    'EXPIRED'
);


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: rental_audit_log; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.rental_audit_log (
    id bigint NOT NULL,
    rental_id bigint,
    payment_schedule_id bigint,
    transaction_id text,
    action text NOT NULL,
    old_value jsonb,
    new_value jsonb,
    changed_by_user_id text,
    changed_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: rental_audit_log_id_seq; Type: SEQUENCE; Schema: app; Owner: -
--

CREATE SEQUENCE app.rental_audit_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: rental_audit_log_id_seq; Type: SEQUENCE OWNED BY; Schema: app; Owner: -
--

ALTER SEQUENCE app.rental_audit_log_id_seq OWNED BY app.rental_audit_log.id;


--
-- Name: rental_documents; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.rental_documents (
    id bigint NOT NULL,
    rental_id bigint NOT NULL,
    document_name text NOT NULL,
    document_type text DEFAULT 'OTHER'::text NOT NULL,
    file_name text,
    file_url text,
    storage_path text,
    uploaded_by_user_id text,
    uploaded_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT rental_documents_document_type_check CHECK ((document_type = ANY (ARRAY['LEASE_AGREEMENT'::text, 'SIGNED_MANDATE'::text, 'PROOF_OF_PAYMENT'::text, 'LANDLORD_FICA'::text, 'TENANT_FICA'::text, 'INSPECTION_DOCUMENT'::text, 'DEPOSIT_PROOF'::text, 'OTHER'::text])))
);


--
-- Name: rental_documents_id_seq; Type: SEQUENCE; Schema: app; Owner: -
--

CREATE SEQUENCE app.rental_documents_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: rental_documents_id_seq; Type: SEQUENCE OWNED BY; Schema: app; Owner: -
--

ALTER SEQUENCE app.rental_documents_id_seq OWNED BY app.rental_documents.id;


--
-- Name: rental_number_seq; Type: SEQUENCE; Schema: app; Owner: -
--

CREATE SEQUENCE app.rental_number_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: rental_participants; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.rental_participants (
    id bigint NOT NULL,
    rental_id bigint NOT NULL,
    associate_id text,
    associate_name text,
    participant_role text NOT NULL,
    split_percentage numeric(8,4) DEFAULT 0 NOT NULL,
    gross_commission_amount numeric(18,2) DEFAULT 0,
    company_dollar_amount numeric(18,2) DEFAULT 0,
    royalty_amount numeric(18,2) DEFAULT 0,
    growth_share_amount numeric(18,2) DEFAULT 0,
    agent_net_amount numeric(18,2) DEFAULT 0,
    counts_toward_cap boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    market_center_split numeric(8,4) DEFAULT 0,
    agent_split numeric(8,4) DEFAULT 0,
    agent_deal_split numeric(8,4) DEFAULT 0,
    CONSTRAINT rental_participants_participant_role_check CHECK ((participant_role = ANY (ARRAY['RENTAL_AGENT'::text, 'LISTING_AGENT'::text, 'REFERRING_AGENT'::text, 'REFERRAL_OFFICE'::text, 'TEAM_LEAD'::text, 'OTHER'::text])))
);


--
-- Name: rental_participants_id_seq; Type: SEQUENCE; Schema: app; Owner: -
--

CREATE SEQUENCE app.rental_participants_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: rental_participants_id_seq; Type: SEQUENCE OWNED BY; Schema: app; Owner: -
--

ALTER SEQUENCE app.rental_participants_id_seq OWNED BY app.rental_participants.id;


--
-- Name: rental_payment_schedule; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.rental_payment_schedule (
    id bigint NOT NULL,
    rental_id bigint NOT NULL,
    payment_sequence_number integer DEFAULT 1 NOT NULL,
    due_date date NOT NULL,
    period_start_date date,
    period_end_date date,
    expected_rental_amount numeric(18,2) DEFAULT 0,
    expected_commission_amount numeric(18,2) DEFAULT 0,
    gross_commission numeric(18,2) DEFAULT 0,
    company_dollar numeric(18,2) DEFAULT 0,
    royalty numeric(18,2) DEFAULT 0,
    growth_share numeric(18,2) DEFAULT 0,
    agent_net_amount numeric(18,2) DEFAULT 0,
    payment_status text DEFAULT 'UPCOMING'::text NOT NULL,
    paid_date timestamp with time zone,
    cancelled_date timestamp with time zone,
    cancelled_reason text,
    transaction_created boolean DEFAULT false NOT NULL,
    transaction_id text,
    created_by_user_id text,
    paid_by_user_id text,
    cancelled_by_user_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT rental_payment_schedule_payment_status_check CHECK ((payment_status = ANY (ARRAY['UPCOMING'::text, 'DUE'::text, 'OVERDUE'::text, 'PAID'::text, 'CANCELLED'::text])))
);


--
-- Name: rental_payment_schedule_id_seq; Type: SEQUENCE; Schema: app; Owner: -
--

CREATE SEQUENCE app.rental_payment_schedule_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: rental_payment_schedule_id_seq; Type: SEQUENCE OWNED BY; Schema: app; Owner: -
--

ALTER SEQUENCE app.rental_payment_schedule_id_seq OWNED BY app.rental_payment_schedule.id;


--
-- Name: rentals; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.rentals (
    id bigint NOT NULL,
    rental_number text NOT NULL,
    market_centre_id text,
    market_centre_name text,
    source_listing_id text,
    listing_number text,
    property_address text NOT NULL,
    suburb text,
    city text,
    province text,
    property_reference text,
    property_notes text,
    landlord_name text,
    landlord_surname_or_company text,
    landlord_id_or_reg_number text,
    landlord_email text,
    landlord_phone text,
    landlord_alternative_phone text,
    landlord_physical_address text,
    landlord_postal_address text,
    landlord_notes text,
    tenant_name text,
    tenant_surname_or_company text,
    tenant_id_or_reg_number text,
    tenant_email text,
    tenant_phone text,
    tenant_alternative_phone text,
    tenant_current_address text,
    tenant_notes text,
    rental_type text NOT NULL,
    rental_status text DEFAULT 'DRAFT'::text NOT NULL,
    lease_start_date date,
    lease_end_date date,
    lease_signed_date date,
    occupation_date date,
    frequency text DEFAULT 'MONTHLY'::text NOT NULL,
    payment_due_day integer,
    payment_due_rule text,
    rental_amount numeric(18,2) DEFAULT 0,
    deposit_amount numeric(18,2) DEFAULT 0,
    procurement_fee_amount numeric(18,2) DEFAULT 0,
    management_fee_percentage numeric(8,4) DEFAULT 0,
    management_fee_amount numeric(18,2) DEFAULT 0,
    gross_commission numeric(18,2) DEFAULT 0,
    company_dollar numeric(18,2) DEFAULT 0,
    royalty numeric(18,2) DEFAULT 0,
    growth_share numeric(18,2) DEFAULT 0,
    agent_net_amount numeric(18,2) DEFAULT 0,
    counts_toward_cap boolean DEFAULT false NOT NULL,
    notes text,
    created_by_user_id text,
    updated_by_user_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    cancelled_at timestamp with time zone,
    cancelled_reason text,
    landlord_country text,
    landlord_province text,
    landlord_city text,
    landlord_suburb text,
    landlord_street_number text,
    landlord_street_name text,
    tenant_country text,
    tenant_province text,
    tenant_city text,
    tenant_suburb text,
    tenant_street_number text,
    tenant_street_name text,
    CONSTRAINT rentals_frequency_check CHECK ((frequency = ANY (ARRAY['ONCE_OFF'::text, 'DAILY'::text, 'WEEKLY'::text, 'MONTHLY'::text, 'YEARLY'::text]))),
    CONSTRAINT rentals_rental_status_check CHECK ((rental_status = ANY (ARRAY['DRAFT'::text, 'ACTIVE'::text, 'CANCELLED'::text, 'COMPLETED'::text]))),
    CONSTRAINT rentals_rental_type_check CHECK ((rental_type = ANY (ARRAY['PROCUREMENT'::text, 'MANAGEMENT'::text])))
);


--
-- Name: rentals_id_seq; Type: SEQUENCE; Schema: app; Owner: -
--

CREATE SEQUENCE app.rentals_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: rentals_id_seq; Type: SEQUENCE OWNED BY; Schema: app; Owner: -
--

ALTER SEQUENCE app.rentals_id_seq OWNED BY app.rentals.id;


--
-- Name: agent_deregistration_log; Type: TABLE; Schema: migration; Owner: -
--

CREATE TABLE migration.agent_deregistration_log (
    id bigint NOT NULL,
    job_id text,
    associate_id bigint NOT NULL,
    associate_name text,
    reason text,
    requested_by text,
    deregistered_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: agent_deregistration_log_id_seq; Type: SEQUENCE; Schema: migration; Owner: -
--

CREATE SEQUENCE migration.agent_deregistration_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: agent_deregistration_log_id_seq; Type: SEQUENCE OWNED BY; Schema: migration; Owner: -
--

ALTER SEQUENCE migration.agent_deregistration_log_id_seq OWNED BY migration.agent_deregistration_log.id;


--
-- Name: agent_reactivation_log; Type: TABLE; Schema: migration; Owner: -
--

CREATE TABLE migration.agent_reactivation_log (
    id bigint NOT NULL,
    associate_id bigint NOT NULL,
    associate_name text,
    old_market_center_id text,
    new_market_center_id text,
    requested_by text,
    reactivated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: agent_reactivation_log_id_seq; Type: SEQUENCE; Schema: migration; Owner: -
--

CREATE SEQUENCE migration.agent_reactivation_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: agent_reactivation_log_id_seq; Type: SEQUENCE OWNED BY; Schema: migration; Owner: -
--

ALTER SEQUENCE migration.agent_reactivation_log_id_seq OWNED BY migration.agent_reactivation_log.id;


--
-- Name: associate_admin_market_centers; Type: TABLE; Schema: migration; Owner: -
--

CREATE TABLE migration.associate_admin_market_centers (
    id bigint NOT NULL,
    associate_id bigint NOT NULL,
    source_market_center_id text
);


--
-- Name: associate_admin_market_centers_id_seq; Type: SEQUENCE; Schema: migration; Owner: -
--

CREATE SEQUENCE migration.associate_admin_market_centers_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: associate_admin_market_centers_id_seq; Type: SEQUENCE OWNED BY; Schema: migration; Owner: -
--

ALTER SEQUENCE migration.associate_admin_market_centers_id_seq OWNED BY migration.associate_admin_market_centers.id;


--
-- Name: associate_admin_teams; Type: TABLE; Schema: migration; Owner: -
--

CREATE TABLE migration.associate_admin_teams (
    id bigint NOT NULL,
    associate_id bigint NOT NULL,
    source_team_id text
);


--
-- Name: associate_admin_teams_id_seq; Type: SEQUENCE; Schema: migration; Owner: -
--

CREATE SEQUENCE migration.associate_admin_teams_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: associate_admin_teams_id_seq; Type: SEQUENCE OWNED BY; Schema: migration; Owner: -
--

ALTER SEQUENCE migration.associate_admin_teams_id_seq OWNED BY migration.associate_admin_teams.id;


--
-- Name: associate_documents; Type: TABLE; Schema: migration; Owner: -
--

CREATE TABLE migration.associate_documents (
    id bigint NOT NULL,
    associate_id bigint NOT NULL,
    document_type text,
    document_name text,
    document_url text,
    uploaded_by text,
    uploaded_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: associate_documents_id_seq; Type: SEQUENCE; Schema: migration; Owner: -
--

CREATE SEQUENCE migration.associate_documents_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: associate_documents_id_seq; Type: SEQUENCE OWNED BY; Schema: migration; Owner: -
--

ALTER SEQUENCE migration.associate_documents_id_seq OWNED BY migration.associate_documents.id;


--
-- Name: associate_job_titles; Type: TABLE; Schema: migration; Owner: -
--

CREATE TABLE migration.associate_job_titles (
    id bigint NOT NULL,
    associate_id bigint NOT NULL,
    job_title text
);


--
-- Name: associate_job_titles_id_seq; Type: SEQUENCE; Schema: migration; Owner: -
--

CREATE SEQUENCE migration.associate_job_titles_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: associate_job_titles_id_seq; Type: SEQUENCE OWNED BY; Schema: migration; Owner: -
--

ALTER SEQUENCE migration.associate_job_titles_id_seq OWNED BY migration.associate_job_titles.id;


--
-- Name: associate_notes; Type: TABLE; Schema: migration; Owner: -
--

CREATE TABLE migration.associate_notes (
    id bigint NOT NULL,
    associate_id bigint NOT NULL,
    note_type text,
    note_text text,
    created_by text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: associate_notes_id_seq; Type: SEQUENCE; Schema: migration; Owner: -
--

CREATE SEQUENCE migration.associate_notes_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: associate_notes_id_seq; Type: SEQUENCE OWNED BY; Schema: migration; Owner: -
--

ALTER SEQUENCE migration.associate_notes_id_seq OWNED BY migration.associate_notes.id;


--
-- Name: associate_roles; Type: TABLE; Schema: migration; Owner: -
--

CREATE TABLE migration.associate_roles (
    id bigint NOT NULL,
    associate_id bigint NOT NULL,
    role_name text
);


--
-- Name: associate_roles_id_seq; Type: SEQUENCE; Schema: migration; Owner: -
--

CREATE SEQUENCE migration.associate_roles_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: associate_roles_id_seq; Type: SEQUENCE OWNED BY; Schema: migration; Owner: -
--

ALTER SEQUENCE migration.associate_roles_id_seq OWNED BY migration.associate_roles.id;


--
-- Name: associate_service_communities; Type: TABLE; Schema: migration; Owner: -
--

CREATE TABLE migration.associate_service_communities (
    id bigint NOT NULL,
    associate_id bigint NOT NULL,
    community_name text
);


--
-- Name: associate_service_communities_id_seq; Type: SEQUENCE; Schema: migration; Owner: -
--

CREATE SEQUENCE migration.associate_service_communities_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: associate_service_communities_id_seq; Type: SEQUENCE OWNED BY; Schema: migration; Owner: -
--

ALTER SEQUENCE migration.associate_service_communities_id_seq OWNED BY migration.associate_service_communities.id;


--
-- Name: associate_social_media; Type: TABLE; Schema: migration; Owner: -
--

CREATE TABLE migration.associate_social_media (
    id bigint NOT NULL,
    associate_id bigint NOT NULL,
    platform text,
    url text,
    sort_order integer DEFAULT 0
);


--
-- Name: associate_social_media_id_seq; Type: SEQUENCE; Schema: migration; Owner: -
--

CREATE SEQUENCE migration.associate_social_media_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: associate_social_media_id_seq; Type: SEQUENCE OWNED BY; Schema: migration; Owner: -
--

ALTER SEQUENCE migration.associate_social_media_id_seq OWNED BY migration.associate_social_media.id;


--
-- Name: associates_prepared; Type: TABLE; Schema: migration; Owner: -
--

CREATE TABLE migration.associates_prepared (
    source_associate_id text NOT NULL,
    first_name text,
    last_name text,
    full_name text,
    email text,
    status_name text,
    market_center_name text,
    team_name text,
    kwuid text,
    last_seen_at timestamp with time zone,
    prepared_at timestamp with time zone DEFAULT now() NOT NULL,
    image_url text,
    mobile_number text,
    office_number text,
    national_id text,
    ffc_number text,
    kwsa_email text,
    private_email text,
    growth_share_sponsor text,
    proposed_growth_share_sponsor text,
    temporary_growth_share_sponsor text,
    start_date date,
    end_date date,
    anniversary_date date,
    cap_date date,
    total_cap_amount numeric(18,2),
    manual_cap numeric(18,2),
    agent_split numeric(10,4)
);


--
-- Name: core_associates; Type: TABLE; Schema: migration; Owner: -
--

CREATE TABLE migration.core_associates (
    id bigint NOT NULL,
    source_associate_id text NOT NULL,
    source_market_center_id text,
    source_team_id text,
    market_center_id bigint,
    team_id bigint,
    first_name text,
    last_name text,
    full_name text,
    email text,
    status_name text,
    kwuid text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    national_id text,
    ffc_number text,
    private_email text,
    mobile_number text,
    office_number text,
    proposed_growth_share_sponsor text,
    temporary_growth_share_sponsor boolean,
    vested boolean DEFAULT false NOT NULL,
    vesting_period_start_date date,
    listing_approval_required boolean DEFAULT false NOT NULL,
    exclude_from_individual_reports boolean DEFAULT false NOT NULL,
    image_url text,
    kwsa_email text,
    property24_opt_in boolean DEFAULT false,
    agent_property24_id text,
    property24_status text,
    entegral_opt_in boolean DEFAULT false,
    agent_entegral_id text,
    entegral_status text,
    private_property_opt_in boolean DEFAULT false,
    private_property_status text,
    cap numeric(18,2),
    manual_cap boolean DEFAULT false,
    agent_split numeric(18,2),
    projected_cos numeric(18,2),
    projected_cap numeric(18,2),
    start_date date,
    end_date date,
    anniversary_date date,
    cap_date date,
    growth_share_sponsor text,
    agent_entegral_portals text[] DEFAULT ARRAY[]::text[] NOT NULL
);


--
-- Name: core_associates_id_seq; Type: SEQUENCE; Schema: migration; Owner: -
--

CREATE SEQUENCE migration.core_associates_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: core_associates_id_seq; Type: SEQUENCE OWNED BY; Schema: migration; Owner: -
--

ALTER SEQUENCE migration.core_associates_id_seq OWNED BY migration.core_associates.id;


--
-- Name: core_listings; Type: TABLE; Schema: migration; Owner: -
--

CREATE TABLE migration.core_listings (
    id bigint NOT NULL,
    source_listing_id text NOT NULL,
    source_market_center_id text,
    market_center_id bigint,
    listing_number text,
    status_name text,
    sale_or_rent text,
    street_number text,
    street_name text,
    suburb text,
    city text,
    province text,
    country text,
    price numeric(18,2),
    expiry_date date,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    property_title text,
    short_title text,
    property_description text,
    listing_images_json jsonb,
    listing_payload jsonb,
    agent_property_valuation numeric(18,2),
    poa boolean DEFAULT false NOT NULL,
    no_transfer_duty boolean DEFAULT false NOT NULL,
    signed_date date,
    on_market_since_date date,
    rates_and_taxes numeric(18,2),
    monthly_levy numeric(18,2),
    mandate_type text,
    address_line text,
    listing_status_tag text,
    ownership_type text,
    property_type text,
    property_sub_type text,
    descriptive_feature text,
    retirement_living boolean DEFAULT false,
    short_description text,
    erf_number text,
    unit_number text,
    door_number text,
    estate_name text,
    postal_code text,
    longitude numeric(10,7),
    latitude numeric(10,7),
    override_display_location boolean DEFAULT false,
    override_display_longitude numeric(10,7),
    override_display_latitude numeric(10,7),
    loom_validation_status text,
    loom_property_id text,
    loom_address text,
    display_address_on_website boolean DEFAULT true,
    viewing_instructions text,
    viewing_directions text,
    feed_to_private_property boolean DEFAULT false,
    private_property_ref1 text,
    private_property_ref2 text,
    private_property_sync_status text,
    feed_to_kww boolean DEFAULT false,
    kww_property_reference text,
    kww_ref1 text,
    kww_ref2 text,
    kww_sync_status text,
    feed_to_entegral boolean DEFAULT false,
    entegral_sync_status text,
    feed_to_property24 boolean DEFAULT false,
    property24_ref1 text,
    property24_ref2 text,
    property24_sync_status text,
    reduced_date date,
    property_auction boolean DEFAULT false,
    occupation_date date,
    erf_size numeric(18,2),
    floor_area numeric(18,2),
    construction_date date,
    height_restriction numeric(18,2),
    out_building_size numeric(18,2),
    zoning_type text,
    is_furnished boolean DEFAULT false,
    pet_friendly boolean DEFAULT false,
    has_standalone_building boolean DEFAULT false,
    has_flatlet boolean DEFAULT false,
    has_backup_water boolean DEFAULT false,
    wheelchair_accessible boolean DEFAULT false,
    has_generator boolean DEFAULT false,
    has_borehole boolean DEFAULT false,
    has_gas_geyser boolean DEFAULT false,
    has_solar_panels boolean DEFAULT false,
    has_backup_battery_or_inverter boolean DEFAULT false,
    has_solar_geyser boolean DEFAULT false,
    has_water_tank boolean DEFAULT false,
    adsl boolean DEFAULT false,
    fibre boolean DEFAULT false,
    isdn boolean DEFAULT false,
    dialup boolean DEFAULT false,
    fixed_wimax boolean DEFAULT false,
    satellite boolean DEFAULT false,
    nearby_bus_service boolean DEFAULT false,
    nearby_minibus_taxi_service boolean DEFAULT false,
    nearby_train_service boolean DEFAULT false,
    is_draft boolean DEFAULT false,
    is_published boolean DEFAULT true,
    rental_rate text,
    lease_period text,
    deposit_requirements text
);


--
-- Name: core_listings_id_seq; Type: SEQUENCE; Schema: migration; Owner: -
--

CREATE SEQUENCE migration.core_listings_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: core_listings_id_seq; Type: SEQUENCE OWNED BY; Schema: migration; Owner: -
--

ALTER SEQUENCE migration.core_listings_id_seq OWNED BY migration.core_listings.id;


--
-- Name: core_market_centers; Type: TABLE; Schema: migration; Owner: -
--

CREATE TABLE migration.core_market_centers (
    id bigint NOT NULL,
    source_market_center_id text NOT NULL,
    name text NOT NULL,
    status_name text,
    frontdoor_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    logo_image_url text,
    company_registered_name text,
    kw_office_id text,
    contact_number text,
    contact_email text,
    has_individual_cap boolean DEFAULT false NOT NULL,
    agent_default_cap numeric(18,2),
    market_center_default_split numeric(10,4),
    agent_default_split numeric(10,4),
    productivity_coach text,
    property24_opt_in boolean DEFAULT false NOT NULL,
    property24_auction_approved boolean DEFAULT false NOT NULL,
    market_center_property24_id text,
    private_property_id text,
    entegral_opt_in boolean DEFAULT false NOT NULL,
    entegral_url text,
    entegral_portals text[] DEFAULT ARRAY[]::text[] NOT NULL,
    country text,
    province text,
    city text,
    suburb text,
    erf_number text,
    unit_number text,
    door_number text,
    estate_name text,
    street_number text,
    street_name text,
    postal_code text,
    longitude numeric(10,7),
    latitude numeric(10,7),
    override_display_location boolean DEFAULT false NOT NULL,
    display_longitude numeric(10,7),
    display_latitude numeric(10,7),
    address_source_id text,
    logo_document_id text
);


--
-- Name: core_market_centers_id_seq; Type: SEQUENCE; Schema: migration; Owner: -
--

CREATE SEQUENCE migration.core_market_centers_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: core_market_centers_id_seq; Type: SEQUENCE OWNED BY; Schema: migration; Owner: -
--

ALTER SEQUENCE migration.core_market_centers_id_seq OWNED BY migration.core_market_centers.id;


--
-- Name: core_teams; Type: TABLE; Schema: migration; Owner: -
--

CREATE TABLE migration.core_teams (
    id bigint NOT NULL,
    source_team_id text NOT NULL,
    source_market_center_id text,
    market_center_id bigint,
    name text NOT NULL,
    status_name text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    registered_name text,
    contact_number text,
    contact_email text,
    logo_url text,
    address_line1 text,
    address_suburb text,
    address_city text,
    address_province text,
    address_postal_code text
);


--
-- Name: core_teams_id_seq; Type: SEQUENCE; Schema: migration; Owner: -
--

CREATE SEQUENCE migration.core_teams_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: core_teams_id_seq; Type: SEQUENCE OWNED BY; Schema: migration; Owner: -
--

ALTER SEQUENCE migration.core_teams_id_seq OWNED BY migration.core_teams.id;


--
-- Name: core_transactions; Type: TABLE; Schema: migration; Owner: -
--

CREATE TABLE migration.core_transactions (
    id bigint NOT NULL,
    source_transaction_id text NOT NULL,
    source_associate_id text DEFAULT ''::text NOT NULL,
    associate_id bigint,
    market_center_id bigint,
    transaction_number text,
    transaction_status text,
    transaction_type text,
    source_listing_id text,
    listing_number text,
    address text,
    suburb text,
    city text,
    sales_price numeric(18,2),
    list_price numeric(18,2),
    gci_excl_vat numeric(18,2),
    split_percentage numeric(10,4),
    net_comm numeric(18,2),
    total_gci numeric(18,2),
    sale_type text,
    agent_type text,
    buyer text,
    seller text,
    list_date timestamp with time zone,
    transaction_date timestamp with time zone,
    status_change_date timestamp with time zone,
    expected_date timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    primary_market_center_id bigint,
    payment_notes text,
    return_notes text,
    source_market_center_id text,
    market_center_name text,
    source_team_id text,
    team_name text,
    current_source_market_center_id text,
    current_market_center_name text,
    current_source_team_id text,
    current_team_name text,
    listing_office_name text,
    variance_per numeric(18,6),
    contract_gci_excl_vat numeric(18,2),
    avg_comms_per numeric(18,6),
    transaction_gci_excl_vat numeric(18,2),
    growth_share numeric(18,2),
    production_royalties numeric(18,2),
    cap_remaining numeric(18,2),
    associate_dollar numeric(18,2),
    mc_dollar numeric(18,2),
    company_dollar numeric(18,2),
    team_dollar numeric(18,2),
    transfer_attorney text,
    ta_mobile_phone text,
    ta_email text,
    bond_attorney_contact_id text,
    bond_attorney text,
    ba_mobile_phone text,
    ba_email text,
    bond_originator text,
    bond_due_date timestamp with time zone,
    bond_amount numeric(18,2),
    transaction_financial_institution_id text,
    transaction_financial_institution text,
    financial_institution_other text,
    transaction_financing_type_id text,
    transaction_financing_type text,
    all_parties_invoiced text,
    transaction_category text,
    source_type text,
    source_rental_id bigint,
    source_rental_payment_schedule_id bigint,
    counts_toward_cap boolean DEFAULT false
);


--
-- Name: core_transactions_id_seq; Type: SEQUENCE; Schema: migration; Owner: -
--

CREATE SEQUENCE migration.core_transactions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: core_transactions_id_seq; Type: SEQUENCE OWNED BY; Schema: migration; Owner: -
--

ALTER SEQUENCE migration.core_transactions_id_seq OWNED BY migration.core_transactions.id;


--
-- Name: id_map_associates; Type: TABLE; Schema: migration; Owner: -
--

CREATE TABLE migration.id_map_associates (
    source_associate_id text NOT NULL,
    core_associate_id bigint NOT NULL
);


--
-- Name: id_map_legacy_associates; Type: TABLE; Schema: migration; Owner: -
--

CREATE TABLE migration.id_map_legacy_associates (
    source_associate_id text NOT NULL,
    legacy_associate_id text NOT NULL,
    published_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: id_map_legacy_listings; Type: TABLE; Schema: migration; Owner: -
--

CREATE TABLE migration.id_map_legacy_listings (
    source_listing_id text NOT NULL,
    legacy_listing_id text NOT NULL,
    published_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: id_map_legacy_market_centers; Type: TABLE; Schema: migration; Owner: -
--

CREATE TABLE migration.id_map_legacy_market_centers (
    source_market_center_id text NOT NULL,
    legacy_market_center_id text NOT NULL,
    published_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: id_map_listings; Type: TABLE; Schema: migration; Owner: -
--

CREATE TABLE migration.id_map_listings (
    source_listing_id text NOT NULL,
    core_listing_id bigint NOT NULL
);


--
-- Name: id_map_market_centers; Type: TABLE; Schema: migration; Owner: -
--

CREATE TABLE migration.id_map_market_centers (
    source_market_center_id text NOT NULL,
    core_market_center_id bigint NOT NULL
);


--
-- Name: id_map_teams; Type: TABLE; Schema: migration; Owner: -
--

CREATE TABLE migration.id_map_teams (
    source_team_id text NOT NULL,
    core_team_id bigint NOT NULL
);


--
-- Name: in_app_notifications; Type: TABLE; Schema: migration; Owner: -
--

CREATE TABLE migration.in_app_notifications (
    id bigint NOT NULL,
    associate_id bigint NOT NULL,
    notification_type text NOT NULL,
    category text NOT NULL,
    title text NOT NULL,
    message text NOT NULL,
    entity_type text,
    entity_id bigint,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    is_read boolean DEFAULT false NOT NULL,
    read_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: in_app_notifications_id_seq; Type: SEQUENCE; Schema: migration; Owner: -
--

CREATE SEQUENCE migration.in_app_notifications_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: in_app_notifications_id_seq; Type: SEQUENCE OWNED BY; Schema: migration; Owner: -
--

ALTER SEQUENCE migration.in_app_notifications_id_seq OWNED BY migration.in_app_notifications.id;


--
-- Name: listing_agents; Type: TABLE; Schema: migration; Owner: -
--

CREATE TABLE migration.listing_agents (
    id bigint NOT NULL,
    listing_id bigint NOT NULL,
    associate_id bigint,
    agent_name text,
    agent_role text DEFAULT 'Agent'::text,
    is_primary boolean DEFAULT false,
    market_center_id bigint,
    sort_order integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: listing_agents_id_seq; Type: SEQUENCE; Schema: migration; Owner: -
--

CREATE SEQUENCE migration.listing_agents_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: listing_agents_id_seq; Type: SEQUENCE OWNED BY; Schema: migration; Owner: -
--

ALTER SEQUENCE migration.listing_agents_id_seq OWNED BY migration.listing_agents.id;


--
-- Name: listing_approval_requests; Type: TABLE; Schema: migration; Owner: -
--

CREATE TABLE migration.listing_approval_requests (
    id bigint NOT NULL,
    listing_id bigint NOT NULL,
    status text NOT NULL,
    submitted_by_associate_id bigint,
    submitted_by_name text,
    submitted_by_email text,
    submission_comment text,
    submitted_at timestamp with time zone,
    reviewed_by_associate_id bigint,
    reviewed_by_name text,
    reviewed_by_email text,
    review_comment text,
    reviewed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: listing_approval_requests_id_seq; Type: SEQUENCE; Schema: migration; Owner: -
--

CREATE SEQUENCE migration.listing_approval_requests_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: listing_approval_requests_id_seq; Type: SEQUENCE OWNED BY; Schema: migration; Owner: -
--

ALTER SEQUENCE migration.listing_approval_requests_id_seq OWNED BY migration.listing_approval_requests.id;


--
-- Name: listing_contacts; Type: TABLE; Schema: migration; Owner: -
--

CREATE TABLE migration.listing_contacts (
    id bigint NOT NULL,
    listing_id bigint NOT NULL,
    full_name text,
    phone_number text,
    email_address text,
    sort_order integer DEFAULT 0
);


--
-- Name: listing_contacts_id_seq; Type: SEQUENCE; Schema: migration; Owner: -
--

CREATE SEQUENCE migration.listing_contacts_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: listing_contacts_id_seq; Type: SEQUENCE OWNED BY; Schema: migration; Owner: -
--

ALTER SEQUENCE migration.listing_contacts_id_seq OWNED BY migration.listing_contacts.id;


--
-- Name: listing_features; Type: TABLE; Schema: migration; Owner: -
--

CREATE TABLE migration.listing_features (
    id bigint NOT NULL,
    listing_id bigint NOT NULL,
    feature_category text,
    feature_value text,
    sort_order integer DEFAULT 0
);


--
-- Name: listing_features_id_seq; Type: SEQUENCE; Schema: migration; Owner: -
--

CREATE SEQUENCE migration.listing_features_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: listing_features_id_seq; Type: SEQUENCE OWNED BY; Schema: migration; Owner: -
--

ALTER SEQUENCE migration.listing_features_id_seq OWNED BY migration.listing_features.id;


--
-- Name: listing_images; Type: TABLE; Schema: migration; Owner: -
--

CREATE TABLE migration.listing_images (
    id bigint NOT NULL,
    listing_id bigint NOT NULL,
    file_name text,
    file_url text,
    media_type text DEFAULT 'image/jpeg'::text,
    sort_order integer DEFAULT 0,
    uploaded_by text DEFAULT 'migration'::text,
    uploaded_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: listing_images_id_seq; Type: SEQUENCE; Schema: migration; Owner: -
--

CREATE SEQUENCE migration.listing_images_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: listing_images_id_seq; Type: SEQUENCE OWNED BY; Schema: migration; Owner: -
--

ALTER SEQUENCE migration.listing_images_id_seq OWNED BY migration.listing_images.id;


--
-- Name: listing_mandate_documents; Type: TABLE; Schema: migration; Owner: -
--

CREATE TABLE migration.listing_mandate_documents (
    id bigint NOT NULL,
    listing_id bigint NOT NULL,
    file_name text,
    file_url text,
    file_type text,
    uploaded_by text,
    uploaded_at timestamp with time zone DEFAULT now() NOT NULL,
    sort_order integer DEFAULT 0
);


--
-- Name: listing_mandate_documents_id_seq; Type: SEQUENCE; Schema: migration; Owner: -
--

CREATE SEQUENCE migration.listing_mandate_documents_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: listing_mandate_documents_id_seq; Type: SEQUENCE OWNED BY; Schema: migration; Owner: -
--

ALTER SEQUENCE migration.listing_mandate_documents_id_seq OWNED BY migration.listing_mandate_documents.id;


--
-- Name: listing_marketing_urls; Type: TABLE; Schema: migration; Owner: -
--

CREATE TABLE migration.listing_marketing_urls (
    id bigint NOT NULL,
    listing_id bigint NOT NULL,
    url text,
    url_type text,
    display_name text,
    sort_order integer DEFAULT 0
);


--
-- Name: listing_marketing_urls_id_seq; Type: SEQUENCE; Schema: migration; Owner: -
--

CREATE SEQUENCE migration.listing_marketing_urls_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: listing_marketing_urls_id_seq; Type: SEQUENCE OWNED BY; Schema: migration; Owner: -
--

ALTER SEQUENCE migration.listing_marketing_urls_id_seq OWNED BY migration.listing_marketing_urls.id;


--
-- Name: listing_open_house; Type: TABLE; Schema: migration; Owner: -
--

CREATE TABLE migration.listing_open_house (
    id bigint NOT NULL,
    listing_id bigint NOT NULL,
    open_house_date date,
    from_time text,
    to_time text,
    average_price text,
    comments text,
    sort_order integer DEFAULT 0
);


--
-- Name: listing_open_house_id_seq; Type: SEQUENCE; Schema: migration; Owner: -
--

CREATE SEQUENCE migration.listing_open_house_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: listing_open_house_id_seq; Type: SEQUENCE OWNED BY; Schema: migration; Owner: -
--

ALTER SEQUENCE migration.listing_open_house_id_seq OWNED BY migration.listing_open_house.id;


--
-- Name: listing_property_areas; Type: TABLE; Schema: migration; Owner: -
--

CREATE TABLE migration.listing_property_areas (
    id bigint NOT NULL,
    listing_id bigint NOT NULL,
    area_type text,
    count integer,
    size numeric(18,2),
    description text,
    sub_features jsonb,
    sort_order integer DEFAULT 0
);


--
-- Name: listing_property_areas_id_seq; Type: SEQUENCE; Schema: migration; Owner: -
--

CREATE SEQUENCE migration.listing_property_areas_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: listing_property_areas_id_seq; Type: SEQUENCE OWNED BY; Schema: migration; Owner: -
--

ALTER SEQUENCE migration.listing_property_areas_id_seq OWNED BY migration.listing_property_areas.id;


--
-- Name: listing_show_times; Type: TABLE; Schema: migration; Owner: -
--

CREATE TABLE migration.listing_show_times (
    id bigint NOT NULL,
    listing_id bigint NOT NULL,
    from_date date,
    from_time text,
    to_date date,
    to_time text,
    catch_phrase text,
    sort_order integer DEFAULT 0
);


--
-- Name: listing_show_times_id_seq; Type: SEQUENCE; Schema: migration; Owner: -
--

CREATE SEQUENCE migration.listing_show_times_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: listing_show_times_id_seq; Type: SEQUENCE OWNED BY; Schema: migration; Owner: -
--

ALTER SEQUENCE migration.listing_show_times_id_seq OWNED BY migration.listing_show_times.id;


--
-- Name: listing_transfer_log; Type: TABLE; Schema: migration; Owner: -
--

CREATE TABLE migration.listing_transfer_log (
    id bigint NOT NULL,
    job_id text NOT NULL,
    listing_id bigint NOT NULL,
    listing_number text,
    from_agent_id bigint,
    from_agent_name text,
    to_agent_id bigint,
    to_agent_name text,
    portals_json jsonb,
    agent_swapped boolean DEFAULT false NOT NULL,
    transfer_error text,
    requested_by text,
    transferred_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: listing_transfer_log_id_seq; Type: SEQUENCE; Schema: migration; Owner: -
--

CREATE SEQUENCE migration.listing_transfer_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: listing_transfer_log_id_seq; Type: SEQUENCE OWNED BY; Schema: migration; Owner: -
--

ALTER SEQUENCE migration.listing_transfer_log_id_seq OWNED BY migration.listing_transfer_log.id;


--
-- Name: listings_prepared; Type: TABLE; Schema: migration; Owner: -
--

CREATE TABLE migration.listings_prepared (
    source_listing_id text NOT NULL,
    listing_number text,
    status_name text,
    market_center_name text,
    sale_or_rent text,
    address_line text,
    erf_number text,
    unit_number text,
    door_number text,
    estate_name text,
    street_number text,
    street_name text,
    postal_code text,
    suburb text,
    city text,
    province text,
    country text,
    longitude numeric(10,7),
    latitude numeric(10,7),
    price numeric(18,2),
    expiry_date date,
    property_title text,
    short_title text,
    property_description text,
    listing_images_json jsonb,
    listing_payload jsonb,
    last_seen_at timestamp with time zone,
    prepared_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: load_rejections; Type: TABLE; Schema: migration; Owner: -
--

CREATE TABLE migration.load_rejections (
    id bigint NOT NULL,
    entity_name text NOT NULL,
    source_id text,
    reason text NOT NULL,
    payload jsonb,
    rejected_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: load_rejections_id_seq; Type: SEQUENCE; Schema: migration; Owner: -
--

CREATE SEQUENCE migration.load_rejections_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: load_rejections_id_seq; Type: SEQUENCE OWNED BY; Schema: migration; Owner: -
--

ALTER SEQUENCE migration.load_rejections_id_seq OWNED BY migration.load_rejections.id;


--
-- Name: market_center_notes; Type: TABLE; Schema: migration; Owner: -
--

CREATE TABLE migration.market_center_notes (
    id bigint NOT NULL,
    market_center_id bigint NOT NULL,
    note_text text NOT NULL,
    created_by text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: market_center_notes_id_seq; Type: SEQUENCE; Schema: migration; Owner: -
--

CREATE SEQUENCE migration.market_center_notes_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: market_center_notes_id_seq; Type: SEQUENCE OWNED BY; Schema: migration; Owner: -
--

ALTER SEQUENCE migration.market_center_notes_id_seq OWNED BY migration.market_center_notes.id;


--
-- Name: market_centers_prepared; Type: TABLE; Schema: migration; Owner: -
--

CREATE TABLE migration.market_centers_prepared (
    source_market_center_id text NOT NULL,
    name text,
    status_name text,
    frontdoor_id text,
    company_registered_name text,
    address_source_id text,
    logo_document_id text,
    contact_number text,
    contact_email text,
    kw_office_id text,
    last_seen_at timestamp with time zone,
    prepared_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: mc_dashboard_daily_snapshots; Type: TABLE; Schema: migration; Owner: -
--

CREATE TABLE migration.mc_dashboard_daily_snapshots (
    snapshot_date date NOT NULL,
    mc_source_id text NOT NULL,
    payload jsonb NOT NULL,
    refreshed_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: mc_document_hub; Type: TABLE; Schema: migration; Owner: -
--

CREATE TABLE migration.mc_document_hub (
    id bigint NOT NULL,
    source_market_center_id text NOT NULL,
    title text NOT NULL,
    description text,
    file_url text NOT NULL,
    original_file_name text NOT NULL,
    mime_type text NOT NULL,
    file_size bigint,
    gcs_object_name text,
    local_file_path text,
    uploaded_by text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: mc_document_hub_id_seq; Type: SEQUENCE; Schema: migration; Owner: -
--

CREATE SEQUENCE migration.mc_document_hub_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: mc_document_hub_id_seq; Type: SEQUENCE OWNED BY; Schema: migration; Owner: -
--

ALTER SEQUENCE migration.mc_document_hub_id_seq OWNED BY migration.mc_document_hub.id;


--
-- Name: outside_agency_contacts; Type: TABLE; Schema: migration; Owner: -
--

CREATE TABLE migration.outside_agency_contacts (
    id bigint NOT NULL,
    transaction_agent_id bigint,
    transaction_id bigint,
    first_name text,
    last_name text,
    email text,
    phone text,
    agency_name text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: outside_agency_contacts_id_seq; Type: SEQUENCE; Schema: migration; Owner: -
--

CREATE SEQUENCE migration.outside_agency_contacts_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: outside_agency_contacts_id_seq; Type: SEQUENCE OWNED BY; Schema: migration; Owner: -
--

ALTER SEQUENCE migration.outside_agency_contacts_id_seq OWNED BY migration.outside_agency_contacts.id;


--
-- Name: rental_transaction_number_seq; Type: SEQUENCE; Schema: migration; Owner: -
--

CREATE SEQUENCE migration.rental_transaction_number_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: team_associate_commissions; Type: TABLE; Schema: migration; Owner: -
--

CREATE TABLE migration.team_associate_commissions (
    id bigint NOT NULL,
    team_id bigint NOT NULL,
    has_individual_cap boolean DEFAULT false NOT NULL,
    associate_default_cap numeric(18,2),
    associate_default_split numeric(5,2),
    productivity_coach text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: team_associate_commissions_id_seq; Type: SEQUENCE; Schema: migration; Owner: -
--

CREATE SEQUENCE migration.team_associate_commissions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: team_associate_commissions_id_seq; Type: SEQUENCE OWNED BY; Schema: migration; Owner: -
--

ALTER SEQUENCE migration.team_associate_commissions_id_seq OWNED BY migration.team_associate_commissions.id;


--
-- Name: team_cap_history; Type: TABLE; Schema: migration; Owner: -
--

CREATE TABLE migration.team_cap_history (
    id bigint NOT NULL,
    team_id bigint NOT NULL,
    commission_split_to_team numeric(5,2),
    team_cap_amount numeric(18,2),
    manual_cap boolean DEFAULT false NOT NULL,
    start_date date,
    end_date date,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: team_cap_history_id_seq; Type: SEQUENCE; Schema: migration; Owner: -
--

CREATE SEQUENCE migration.team_cap_history_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: team_cap_history_id_seq; Type: SEQUENCE OWNED BY; Schema: migration; Owner: -
--

ALTER SEQUENCE migration.team_cap_history_id_seq OWNED BY migration.team_cap_history.id;


--
-- Name: team_caps; Type: TABLE; Schema: migration; Owner: -
--

CREATE TABLE migration.team_caps (
    id bigint NOT NULL,
    team_id bigint NOT NULL,
    commission_split_to_team numeric(5,2),
    team_cap_amount numeric(18,2),
    manual_cap boolean DEFAULT false NOT NULL,
    cap_year integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: team_caps_id_seq; Type: SEQUENCE; Schema: migration; Owner: -
--

CREATE SEQUENCE migration.team_caps_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: team_caps_id_seq; Type: SEQUENCE OWNED BY; Schema: migration; Owner: -
--

ALTER SEQUENCE migration.team_caps_id_seq OWNED BY migration.team_caps.id;


--
-- Name: team_dates; Type: TABLE; Schema: migration; Owner: -
--

CREATE TABLE migration.team_dates (
    id bigint NOT NULL,
    team_id bigint NOT NULL,
    open_date date,
    close_date date,
    cap_date date,
    anniversary_date date,
    anniversary_comment text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: team_dates_id_seq; Type: SEQUENCE; Schema: migration; Owner: -
--

CREATE SEQUENCE migration.team_dates_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: team_dates_id_seq; Type: SEQUENCE OWNED BY; Schema: migration; Owner: -
--

ALTER SEQUENCE migration.team_dates_id_seq OWNED BY migration.team_dates.id;


--
-- Name: team_notes; Type: TABLE; Schema: migration; Owner: -
--

CREATE TABLE migration.team_notes (
    id bigint NOT NULL,
    team_id bigint NOT NULL,
    note_text text NOT NULL,
    note_type text DEFAULT 'general'::text NOT NULL,
    created_by text DEFAULT 'console-user'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: team_notes_id_seq; Type: SEQUENCE; Schema: migration; Owner: -
--

CREATE SEQUENCE migration.team_notes_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: team_notes_id_seq; Type: SEQUENCE OWNED BY; Schema: migration; Owner: -
--

ALTER SEQUENCE migration.team_notes_id_seq OWNED BY migration.team_notes.id;


--
-- Name: team_portal_settings; Type: TABLE; Schema: migration; Owner: -
--

CREATE TABLE migration.team_portal_settings (
    id bigint NOT NULL,
    team_id bigint NOT NULL,
    use_mc_account_p24 boolean DEFAULT true NOT NULL,
    p24_agency_id text,
    feed_to_p24 boolean DEFAULT true NOT NULL,
    p24_auction_approved boolean DEFAULT false NOT NULL,
    use_mc_account_entegral boolean DEFAULT true NOT NULL,
    entegral_url text,
    feed_to_entegral boolean DEFAULT true NOT NULL,
    entegral_portals text[] DEFAULT ARRAY[]::text[] NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: team_portal_settings_id_seq; Type: SEQUENCE; Schema: migration; Owner: -
--

CREATE SEQUENCE migration.team_portal_settings_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: team_portal_settings_id_seq; Type: SEQUENCE OWNED BY; Schema: migration; Owner: -
--

ALTER SEQUENCE migration.team_portal_settings_id_seq OWNED BY migration.team_portal_settings.id;


--
-- Name: teams_prepared; Type: TABLE; Schema: migration; Owner: -
--

CREATE TABLE migration.teams_prepared (
    source_team_id text NOT NULL,
    source_market_center_id text,
    name text,
    status_name text,
    last_seen_at timestamp with time zone,
    prepared_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: transaction_agent_calculations; Type: TABLE; Schema: migration; Owner: -
--

CREATE TABLE migration.transaction_agent_calculations (
    id bigint NOT NULL,
    transaction_id bigint,
    transaction_agent_id bigint,
    associate_id bigint,
    agent_name text,
    office_name text,
    transaction_side text,
    effective_reporting_date date,
    is_registered boolean DEFAULT false,
    split_percentage numeric(18,4),
    variance_sale_list_pct numeric(18,4),
    transaction_gci_before_fees numeric(18,2),
    average_commission_pct numeric(18,4),
    production_royalties numeric(18,2),
    growth_share numeric(18,2),
    total_pr_and_gs numeric(18,2),
    gci_after_fees_excl_vat numeric(18,2),
    associate_dollar numeric(18,2),
    cap_amount numeric(18,2),
    cap_remaining numeric(18,2),
    team_dollar numeric(18,2),
    market_center_dollar numeric(18,2),
    is_outside_agent boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    source_associate_id text,
    sales_value_component numeric(18,2) DEFAULT 0 NOT NULL,
    associate_split_pct numeric(10,4) DEFAULT 0 NOT NULL,
    market_center_split_pct numeric(10,4) DEFAULT 0 NOT NULL,
    cap_contribution numeric(18,2) DEFAULT 0 NOT NULL,
    cap_cycle_start_date date,
    cap_cycle_end_date date
);


--
-- Name: transaction_agent_calculations_id_seq; Type: SEQUENCE; Schema: migration; Owner: -
--

CREATE SEQUENCE migration.transaction_agent_calculations_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: transaction_agent_calculations_id_seq; Type: SEQUENCE OWNED BY; Schema: migration; Owner: -
--

ALTER SEQUENCE migration.transaction_agent_calculations_id_seq OWNED BY migration.transaction_agent_calculations.id;


--
-- Name: transaction_agents; Type: TABLE; Schema: migration; Owner: -
--

CREATE TABLE migration.transaction_agents (
    id bigint NOT NULL,
    transaction_id bigint NOT NULL,
    associate_id bigint,
    source_associate_id text,
    agent_name text,
    agent_role text,
    split_percentage numeric(10,4) DEFAULT 0,
    outside_agency boolean DEFAULT false,
    sort_order integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: transaction_agents_id_seq; Type: SEQUENCE; Schema: migration; Owner: -
--

CREATE SEQUENCE migration.transaction_agents_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: transaction_agents_id_seq; Type: SEQUENCE OWNED BY; Schema: migration; Owner: -
--

ALTER SEQUENCE migration.transaction_agents_id_seq OWNED BY migration.transaction_agents.id;


--
-- Name: transaction_documents; Type: TABLE; Schema: migration; Owner: -
--

CREATE TABLE migration.transaction_documents (
    id bigint NOT NULL,
    transaction_id bigint NOT NULL,
    source_document_id text,
    source_transaction_document_type_id text,
    transaction_document_type text,
    file_name text,
    document_url text,
    preview_url text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone
);


--
-- Name: transaction_documents_id_seq; Type: SEQUENCE; Schema: migration; Owner: -
--

CREATE SEQUENCE migration.transaction_documents_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: transaction_documents_id_seq; Type: SEQUENCE OWNED BY; Schema: migration; Owner: -
--

ALTER SEQUENCE migration.transaction_documents_id_seq OWNED BY migration.transaction_documents.id;


--
-- Name: transaction_status_history; Type: TABLE; Schema: migration; Owner: -
--

CREATE TABLE migration.transaction_status_history (
    id bigint NOT NULL,
    transaction_id bigint NOT NULL,
    previous_status text,
    new_status text NOT NULL,
    changed_at timestamp with time zone DEFAULT now() NOT NULL,
    changed_by text,
    notes text,
    changed_by_user_id text,
    changed_by_email text
);


--
-- Name: transaction_status_history_id_seq; Type: SEQUENCE; Schema: migration; Owner: -
--

CREATE SEQUENCE migration.transaction_status_history_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: transaction_status_history_id_seq; Type: SEQUENCE OWNED BY; Schema: migration; Owner: -
--

ALTER SEQUENCE migration.transaction_status_history_id_seq OWNED BY migration.transaction_status_history.id;


--
-- Name: transactions_prepared; Type: TABLE; Schema: migration; Owner: -
--

CREATE TABLE migration.transactions_prepared (
    source_transaction_id text NOT NULL,
    source_associate_id text DEFAULT ''::text NOT NULL,
    transaction_number text,
    source_market_center_id text,
    market_center_name text,
    associate_name text,
    transaction_status text,
    source_listing_id text,
    listing_number text,
    transaction_type text,
    address text,
    suburb text,
    city text,
    sales_price numeric(18,2),
    list_price numeric(18,2),
    gci_excl_vat numeric(18,2),
    split_percentage numeric(10,4),
    net_comm numeric(18,2),
    total_gci numeric(18,2),
    sale_type text,
    agent_type text,
    buyer text,
    seller text,
    list_date timestamp with time zone,
    transaction_date timestamp with time zone,
    status_change_date timestamp with time zone,
    expected_date timestamp with time zone,
    last_seen_at timestamp with time zone,
    prepared_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: SoftDeleteHelper; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."SoftDeleteHelper" (
    id text NOT NULL
);


--
-- Name: addresses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.addresses (
    id integer NOT NULL,
    "streetNumber" text,
    "streetName" text,
    "unitNumber" text,
    "erfNumber" text,
    "postalCode" text,
    "estateName" text,
    "doorNumber" text,
    "suburbId" integer NOT NULL,
    "cityId" integer NOT NULL,
    "provinceId" integer NOT NULL,
    "countryId" integer NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: addresses_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.addresses_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: addresses_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.addresses_id_seq OWNED BY public.addresses.id;


--
-- Name: app_users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_users (
    id integer NOT NULL,
    google_id text NOT NULL,
    email text NOT NULL,
    name text NOT NULL,
    picture text,
    role text DEFAULT 'viewer'::text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: app_users_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.app_users_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: app_users_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.app_users_id_seq OWNED BY public.app_users.id;


--
-- Name: associate_business_details; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.associate_business_details (
    id integer NOT NULL,
    "associateId" integer NOT NULL,
    kwuid text,
    "breeNumber" text,
    "proposedGrowthShareSponsor" text,
    "growthShareSponsorId" integer,
    "temporaryGrowthShareSponsor" boolean DEFAULT false NOT NULL,
    "listingApprovalRequired" boolean DEFAULT false NOT NULL,
    "excludeFromIndividualReports" boolean DEFAULT false CONSTRAINT "associate_business_details_excludeFromIndividualReport_not_null" NOT NULL,
    vested boolean DEFAULT false NOT NULL,
    "vestingStartPeriod" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: associate_business_details_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.associate_business_details_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: associate_business_details_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.associate_business_details_id_seq OWNED BY public.associate_business_details.id;


--
-- Name: associate_contact_details; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.associate_contact_details (
    id integer NOT NULL,
    "associateId" integer NOT NULL,
    email text,
    "privateEmail" text,
    phone text,
    fax text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: associate_contact_details_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.associate_contact_details_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: associate_contact_details_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.associate_contact_details_id_seq OWNED BY public.associate_contact_details.id;


--
-- Name: associate_statuses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.associate_statuses (
    id integer NOT NULL,
    name text NOT NULL
);


--
-- Name: associate_statuses_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.associate_statuses_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: associate_statuses_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.associate_statuses_id_seq OWNED BY public.associate_statuses.id;


--
-- Name: associate_third_party_integrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.associate_third_party_integrations (
    id integer NOT NULL,
    "associateId" integer NOT NULL,
    "p24AgentId" integer,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: associate_third_party_integrations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.associate_third_party_integrations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: associate_third_party_integrations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.associate_third_party_integrations_id_seq OWNED BY public.associate_third_party_integrations.id;


--
-- Name: associate_transfer_statuses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.associate_transfer_statuses (
    id integer NOT NULL,
    name text NOT NULL
);


--
-- Name: associate_transfer_statuses_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.associate_transfer_statuses_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: associate_transfer_statuses_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.associate_transfer_statuses_id_seq OWNED BY public.associate_transfer_statuses.id;


--
-- Name: associate_transfers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.associate_transfers (
    id integer NOT NULL,
    "associateId" integer NOT NULL,
    "marketCenterFromId" integer NOT NULL,
    "marketCenterToId" integer NOT NULL,
    "teamId" integer,
    "property24IdOldOffice" integer,
    "property24IdNewOffice" integer,
    "associateTransactionMove" boolean DEFAULT false NOT NULL,
    "transferStatusId" integer NOT NULL,
    "errorMessage" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "whoUpdatedId" text
);


--
-- Name: associate_transfers_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.associate_transfers_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: associate_transfers_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.associate_transfers_id_seq OWNED BY public.associate_transfers.id;


--
-- Name: associates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.associates (
    id integer NOT NULL,
    "userId" text,
    "firstName" text NOT NULL,
    "lastName" text NOT NULL,
    "nationalId" text,
    "ffcNumber" text,
    "statusId" integer NOT NULL,
    "marketCenterId" integer NOT NULL,
    "teamId" integer,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "deletedAt" timestamp(3) without time zone
);


--
-- Name: associates_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.associates_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: associates_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.associates_id_seq OWNED BY public.associates.id;


--
-- Name: audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_logs (
    id text NOT NULL,
    "userId" text,
    action text NOT NULL,
    entity text NOT NULL,
    "entityId" integer NOT NULL,
    changes jsonb,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: cities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cities (
    id integer NOT NULL,
    name text NOT NULL,
    "provinceId" integer NOT NULL,
    "p24Id" integer,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: cities_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.cities_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: cities_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.cities_id_seq OWNED BY public.cities.id;


--
-- Name: cma_documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cma_documents (
    id integer NOT NULL,
    associate_email text NOT NULL,
    associate_db_id text,
    property_address text,
    seller_name text,
    file_name text NOT NULL,
    file_url text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    seller_first_name text,
    seller_last_name text,
    seller_email text,
    seller_phone text,
    loom_file_url text,
    loom_original_name text
);


--
-- Name: cma_documents_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.cma_documents_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: cma_documents_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.cma_documents_id_seq OWNED BY public.cma_documents.id;


--
-- Name: contacts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contacts (
    id integer NOT NULL,
    name text NOT NULL,
    email text,
    phone text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "deletedAt" timestamp(3) without time zone
);


--
-- Name: contacts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.contacts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: contacts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.contacts_id_seq OWNED BY public.contacts.id;


--
-- Name: countries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.countries (
    id integer NOT NULL,
    name text NOT NULL,
    "p24Id" integer,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: countries_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.countries_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: countries_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.countries_id_seq OWNED BY public.countries.id;


--
-- Name: documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.documents (
    id text NOT NULL,
    url text NOT NULL,
    "contentType" text NOT NULL,
    size integer NOT NULL,
    "orderNumber" integer DEFAULT 0 NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: email_types; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_types (
    id integer NOT NULL,
    name text NOT NULL
);


--
-- Name: email_types_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.email_types_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: email_types_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.email_types_id_seq OWNED BY public.email_types.id;


--
-- Name: icon_types; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.icon_types (
    id integer NOT NULL,
    name text NOT NULL
);


--
-- Name: icon_types_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.icon_types_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: icon_types_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.icon_types_id_seq OWNED BY public.icon_types.id;


--
-- Name: listing_associate_types; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.listing_associate_types (
    id integer NOT NULL,
    name text NOT NULL
);


--
-- Name: listing_associate_types_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.listing_associate_types_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: listing_associate_types_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.listing_associate_types_id_seq OWNED BY public.listing_associate_types.id;


--
-- Name: listing_associates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.listing_associates (
    id integer NOT NULL,
    "listingId" integer NOT NULL,
    "associateId" integer NOT NULL,
    "isPrimary" boolean DEFAULT false NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: listing_associates_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.listing_associates_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: listing_associates_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.listing_associates_id_seq OWNED BY public.listing_associates.id;


--
-- Name: listing_building_area_feature_types; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.listing_building_area_feature_types (
    id integer NOT NULL,
    name text NOT NULL,
    "p24Tag" text
);


--
-- Name: listing_building_area_feature_types_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.listing_building_area_feature_types_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: listing_building_area_feature_types_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.listing_building_area_feature_types_id_seq OWNED BY public.listing_building_area_feature_types.id;


--
-- Name: listing_building_area_features; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.listing_building_area_features (
    id integer NOT NULL,
    "buildingInfoId" integer NOT NULL,
    "featureId" integer NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: listing_building_area_features_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.listing_building_area_features_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: listing_building_area_features_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.listing_building_area_features_id_seq OWNED BY public.listing_building_area_features.id;


--
-- Name: listing_building_infos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.listing_building_infos (
    id integer NOT NULL,
    "listingId" integer NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: listing_building_infos_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.listing_building_infos_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: listing_building_infos_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.listing_building_infos_id_seq OWNED BY public.listing_building_infos.id;


--
-- Name: listing_building_zoning_types; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.listing_building_zoning_types (
    id integer NOT NULL,
    name text NOT NULL
);


--
-- Name: listing_building_zoning_types_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.listing_building_zoning_types_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: listing_building_zoning_types_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.listing_building_zoning_types_id_seq OWNED BY public.listing_building_zoning_types.id;


--
-- Name: listing_descriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.listing_descriptions (
    id integer NOT NULL,
    "listingId" integer NOT NULL,
    "propertyTitle" text,
    "propertyDescription" text,
    "shortDescription" text,
    "listingTypeId" integer NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: listing_descriptions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.listing_descriptions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: listing_descriptions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.listing_descriptions_id_seq OWNED BY public.listing_descriptions.id;


--
-- Name: listing_document_types; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.listing_document_types (
    id integer NOT NULL,
    name text NOT NULL
);


--
-- Name: listing_document_types_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.listing_document_types_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: listing_document_types_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.listing_document_types_id_seq OWNED BY public.listing_document_types.id;


--
-- Name: listing_images; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.listing_images (
    id integer NOT NULL,
    "listingId" integer NOT NULL,
    "documentId" text NOT NULL,
    "orderNumber" integer DEFAULT 0 NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: listing_images_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.listing_images_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: listing_images_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.listing_images_id_seq OWNED BY public.listing_images.id;


--
-- Name: listing_lightstone_validation_statuses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.listing_lightstone_validation_statuses (
    id integer NOT NULL,
    name text NOT NULL
);


--
-- Name: listing_lightstone_validation_statuses_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.listing_lightstone_validation_statuses_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: listing_lightstone_validation_statuses_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.listing_lightstone_validation_statuses_id_seq OWNED BY public.listing_lightstone_validation_statuses.id;


--
-- Name: listing_lightstone_validations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.listing_lightstone_validations (
    id integer NOT NULL,
    "listingId" integer NOT NULL,
    "lightStonePropertyId" integer,
    "validationStatus" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: listing_lightstone_validations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.listing_lightstone_validations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: listing_lightstone_validations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.listing_lightstone_validations_id_seq OWNED BY public.listing_lightstone_validations.id;


--
-- Name: listing_loom_validation_statuses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.listing_loom_validation_statuses (
    id integer NOT NULL,
    name text NOT NULL
);


--
-- Name: listing_loom_validation_statuses_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.listing_loom_validation_statuses_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: listing_loom_validation_statuses_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.listing_loom_validation_statuses_id_seq OWNED BY public.listing_loom_validation_statuses.id;


--
-- Name: listing_mandate_infos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.listing_mandate_infos (
    id integer NOT NULL,
    "listingId" integer NOT NULL,
    "mandateTypeId" integer NOT NULL,
    "signedDate" timestamp(3) without time zone,
    "onMarketSince" timestamp(3) without time zone,
    "ratesTaxes" numeric(65,30),
    "monthlyLevy" numeric(65,30),
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: listing_mandate_infos_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.listing_mandate_infos_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: listing_mandate_infos_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.listing_mandate_infos_id_seq OWNED BY public.listing_mandate_infos.id;


--
-- Name: listing_mandate_types; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.listing_mandate_types (
    id integer NOT NULL,
    name text NOT NULL
);


--
-- Name: listing_mandate_types_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.listing_mandate_types_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: listing_mandate_types_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.listing_mandate_types_id_seq OWNED BY public.listing_mandate_types.id;


--
-- Name: listing_marketing_url_types; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.listing_marketing_url_types (
    id integer NOT NULL,
    name text NOT NULL
);


--
-- Name: listing_marketing_url_types_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.listing_marketing_url_types_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: listing_marketing_url_types_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.listing_marketing_url_types_id_seq OWNED BY public.listing_marketing_url_types.id;


--
-- Name: listing_marketing_urls; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.listing_marketing_urls (
    id integer NOT NULL,
    "listingId" integer NOT NULL,
    url text NOT NULL,
    "marketingUrlTypeId" integer NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: listing_marketing_urls_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.listing_marketing_urls_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: listing_marketing_urls_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.listing_marketing_urls_id_seq OWNED BY public.listing_marketing_urls.id;


--
-- Name: listing_ownership_types; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.listing_ownership_types (
    id integer NOT NULL,
    name text NOT NULL
);


--
-- Name: listing_ownership_types_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.listing_ownership_types_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: listing_ownership_types_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.listing_ownership_types_id_seq OWNED BY public.listing_ownership_types.id;


--
-- Name: listing_p24_feed_item_statuses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.listing_p24_feed_item_statuses (
    id integer NOT NULL,
    name text NOT NULL
);


--
-- Name: listing_p24_feed_item_statuses_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.listing_p24_feed_item_statuses_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: listing_p24_feed_item_statuses_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.listing_p24_feed_item_statuses_id_seq OWNED BY public.listing_p24_feed_item_statuses.id;


--
-- Name: listing_p24_feed_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.listing_p24_feed_items (
    id integer NOT NULL,
    "listingId" integer NOT NULL,
    "statusId" integer NOT NULL,
    "jsonToFeed" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: listing_p24_feed_items_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.listing_p24_feed_items_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: listing_p24_feed_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.listing_p24_feed_items_id_seq OWNED BY public.listing_p24_feed_items.id;


--
-- Name: listing_price_details; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.listing_price_details (
    id integer NOT NULL,
    "listingId" integer NOT NULL,
    price numeric(65,30) NOT NULL,
    poa boolean DEFAULT false NOT NULL,
    "noTransferDuty" boolean DEFAULT false NOT NULL,
    "ignoreForPriceReducedAlerts" boolean DEFAULT false NOT NULL,
    repossessed boolean DEFAULT false NOT NULL,
    "agentPropertyValuation" numeric(65,30),
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: listing_price_details_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.listing_price_details_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: listing_price_details_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.listing_price_details_id_seq OWNED BY public.listing_price_details.id;


--
-- Name: listing_property_area_types; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.listing_property_area_types (
    id integer NOT NULL,
    name text NOT NULL
);


--
-- Name: listing_property_area_types_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.listing_property_area_types_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: listing_property_area_types_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.listing_property_area_types_id_seq OWNED BY public.listing_property_area_types.id;


--
-- Name: listing_property_areas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.listing_property_areas (
    id integer NOT NULL,
    "listingId" integer NOT NULL,
    "propertyAreaTypeId" integer NOT NULL,
    size numeric(65,30),
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: listing_property_areas_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.listing_property_areas_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: listing_property_areas_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.listing_property_areas_id_seq OWNED BY public.listing_property_areas.id;


--
-- Name: listing_property_feature_listing_sub_types; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.listing_property_feature_listing_sub_types (
    "listingPropertyFeaturesId" integer CONSTRAINT "listing_property_feature_lis_listingPropertyFeaturesId_not_null" NOT NULL,
    "listingSubTypesId" integer CONSTRAINT "listing_property_feature_listing_sub_listingSubTypesId_not_null" NOT NULL
);


--
-- Name: listing_property_feature_listing_types; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.listing_property_feature_listing_types (
    "listingPropertyFeaturesId" integer CONSTRAINT "listing_property_feature_li_listingPropertyFeaturesId_not_null1" NOT NULL,
    "listingTypesId" integer NOT NULL
);


--
-- Name: listing_sale_or_rent_types; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.listing_sale_or_rent_types (
    id integer NOT NULL,
    name text NOT NULL
);


--
-- Name: listing_sale_or_rent_types_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.listing_sale_or_rent_types_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: listing_sale_or_rent_types_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.listing_sale_or_rent_types_id_seq OWNED BY public.listing_sale_or_rent_types.id;


--
-- Name: listing_status_tags; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.listing_status_tags (
    id integer NOT NULL,
    name text NOT NULL
);


--
-- Name: listing_status_tags_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.listing_status_tags_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: listing_status_tags_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.listing_status_tags_id_seq OWNED BY public.listing_status_tags.id;


--
-- Name: listing_statuses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.listing_statuses (
    id integer NOT NULL,
    name text NOT NULL
);


--
-- Name: listing_statuses_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.listing_statuses_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: listing_statuses_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.listing_statuses_id_seq OWNED BY public.listing_statuses.id;


--
-- Name: listing_sub_types; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.listing_sub_types (
    id integer NOT NULL,
    name text NOT NULL
);


--
-- Name: listing_sub_types_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.listing_sub_types_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: listing_sub_types_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.listing_sub_types_id_seq OWNED BY public.listing_sub_types.id;


--
-- Name: listing_third_party_integrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.listing_third_party_integrations (
    id integer NOT NULL,
    "listingId" integer NOT NULL,
    "property24Reference" integer,
    "privatePropertyReference" text,
    "kwwReference" text,
    "entegralReference" text,
    "kwwSyncMessage" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: listing_third_party_integrations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.listing_third_party_integrations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: listing_third_party_integrations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.listing_third_party_integrations_id_seq OWNED BY public.listing_third_party_integrations.id;


--
-- Name: listing_types; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.listing_types (
    id integer NOT NULL,
    name text NOT NULL
);


--
-- Name: listing_types_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.listing_types_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: listing_types_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.listing_types_id_seq OWNED BY public.listing_types.id;


--
-- Name: listings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.listings (
    id integer NOT NULL,
    "listingNumber" text NOT NULL,
    "addressId" integer NOT NULL,
    "marketCenterId" integer NOT NULL,
    "statusId" integer NOT NULL,
    "statusTagId" integer,
    "saleOrRentTypeId" integer NOT NULL,
    "mandateTypeId" integer NOT NULL,
    "listingTypeId" integer,
    "listingDate" timestamp(3) without time zone,
    "expiryDate" timestamp(3) without time zone,
    "reducedDate" timestamp(3) without time zone,
    "pendingDate" timestamp(3) without time zone,
    "withdrawnDate" timestamp(3) without time zone,
    "occupationDate" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "deletedAt" timestamp(3) without time zone
);


--
-- Name: listings_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.listings_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: listings_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.listings_id_seq OWNED BY public.listings.id;


--
-- Name: loom_user_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.loom_user_tokens (
    id integer NOT NULL,
    user_email text NOT NULL,
    access_enc text NOT NULL,
    refresh_enc text,
    expires_at timestamp with time zone,
    loom_email text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    consent_accepted boolean DEFAULT false NOT NULL
);


--
-- Name: loom_user_tokens_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.loom_user_tokens_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: loom_user_tokens_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.loom_user_tokens_id_seq OWNED BY public.loom_user_tokens.id;


--
-- Name: market_center_statuses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.market_center_statuses (
    id integer NOT NULL,
    name text NOT NULL
);


--
-- Name: market_center_statuses_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.market_center_statuses_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: market_center_statuses_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.market_center_statuses_id_seq OWNED BY public.market_center_statuses.id;


--
-- Name: market_centers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.market_centers (
    id integer NOT NULL,
    name text NOT NULL,
    "addressId" integer NOT NULL,
    "frontdoorId" integer,
    "statusId" integer NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "deletedAt" timestamp(3) without time zone
);


--
-- Name: market_centers_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.market_centers_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: market_centers_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.market_centers_id_seq OWNED BY public.market_centers.id;


--
-- Name: marketing_plan_documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.marketing_plan_documents (
    id integer NOT NULL,
    associate_email text NOT NULL,
    associate_db_id text,
    property_address text,
    seller_name text,
    source_cma_id integer,
    file_name text NOT NULL,
    file_url text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: marketing_plan_documents_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.marketing_plan_documents_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: marketing_plan_documents_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.marketing_plan_documents_id_seq OWNED BY public.marketing_plan_documents.id;


--
-- Name: provinces; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.provinces (
    id integer NOT NULL,
    name text NOT NULL,
    "countryId" integer NOT NULL,
    "p24Id" integer,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: provinces_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.provinces_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: provinces_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.provinces_id_seq OWNED BY public.provinces.id;


--
-- Name: public_agents_v; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.public_agents_v AS
 SELECT (id)::text AS id,
    lower(TRIM(BOTH '-'::text FROM regexp_replace(TRIM(BOTH FROM ((COALESCE("firstName", ''::text) || ' '::text) || COALESCE("lastName", ''::text))), '[^a-zA-Z0-9]+'::text, '-'::text, 'g'::text))) AS slug,
    TRIM(BOTH FROM ((COALESCE("firstName", ''::text) || ' '::text) || COALESCE("lastName", ''::text))) AS name,
    'Agent'::text AS title,
    NULL::text AS phone,
    NULL::text AS email,
    NULL::text AS whatsapp,
    NULL::text AS photo_url,
    ("marketCenterId")::text AS market_center_id,
    ("teamId")::text AS team_id
   FROM public.associates a
  WHERE ("deletedAt" IS NULL);


--
-- Name: public_leads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.public_leads (
    id bigint NOT NULL,
    listing_id text NOT NULL,
    internal_listing_agent_id text NOT NULL,
    display_context_type text NOT NULL,
    display_context_id text NOT NULL,
    public_display_contact_id text NOT NULL,
    page_url text NOT NULL,
    lead_name text NOT NULL,
    lead_phone text NOT NULL,
    lead_email text NOT NULL,
    message text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: public_leads_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.public_leads_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: public_leads_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.public_leads_id_seq OWNED BY public.public_leads.id;


--
-- Name: public_listings_v; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.public_listings_v AS
 WITH primary_agent AS (
         SELECT DISTINCT ON (la."listingId") la."listingId",
            la."associateId"
           FROM public.listing_associates la
          ORDER BY la."listingId", la."isPrimary" DESC, la.id
        ), images AS (
         SELECT li."listingId",
            COALESCE(array_agg(('/media/'::text || li."documentId") ORDER BY li."orderNumber") FILTER (WHERE (li."documentId" IS NOT NULL)), ARRAY[]::text[]) AS image_urls
           FROM public.listing_images li
          GROUP BY li."listingId"
        )
 SELECT (l.id)::text AS id,
    lower(TRIM(BOTH '-'::text FROM regexp_replace(COALESCE(ld."propertyTitle", l."listingNumber"), '[^a-zA-Z0-9]+'::text, '-'::text, 'g'::text))) AS slug,
    l."listingNumber" AS listing_number,
    COALESCE(ld."propertyTitle", l."listingNumber") AS title,
    COALESCE(ld."shortDescription", ''::text) AS short_description,
    COALESCE(ld."propertyDescription", ''::text) AS description,
    COALESCE(lt.name, 'Property'::text) AS property_type,
        CASE
            WHEN (upper(COALESCE(lsr.name, 'SALE'::text)) ~~ '%RENT%'::text) THEN 'RENT'::text
            ELSE 'SALE'::text
        END AS sale_or_rent,
    ''::text AS suburb,
    ''::text AS city,
    ''::text AS province,
    (lpd.price)::numeric AS price,
    0 AS bedrooms,
    0 AS bathrooms,
    0 AS garages,
    0 AS parking,
    l."updatedAt" AS updated_at,
    l."listingDate" AS published_at,
    COALESCE(ls.name, 'LIVE'::text) AS status,
    COALESCE(img.image_urls, ARRAY[]::text[]) AS image_urls,
    (pa."associateId")::text AS internal_listing_agent_id,
    (l."marketCenterId")::text AS market_center_id,
    (a."teamId")::text AS team_id,
    ARRAY[]::text[] AS feature_tags
   FROM ((((((((public.listings l
     LEFT JOIN public.listing_descriptions ld ON ((ld."listingId" = l.id)))
     LEFT JOIN public.listing_price_details lpd ON ((lpd."listingId" = l.id)))
     LEFT JOIN public.listing_types lt ON ((lt.id = l."listingTypeId")))
     LEFT JOIN public.listing_sale_or_rent_types lsr ON ((lsr.id = l."saleOrRentTypeId")))
     LEFT JOIN public.listing_statuses ls ON ((ls.id = l."statusId")))
     LEFT JOIN primary_agent pa ON ((pa."listingId" = l.id)))
     LEFT JOIN public.associates a ON ((a.id = pa."associateId")))
     LEFT JOIN images img ON ((img."listingId" = l.id)))
  WHERE (l."deletedAt" IS NULL);


--
-- Name: public_market_centres_v; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.public_market_centres_v AS
 SELECT (id)::text AS id,
    lower(TRIM(BOTH '-'::text FROM regexp_replace(name, '[^a-zA-Z0-9]+'::text, '-'::text, 'g'::text))) AS slug,
    name,
    NULL::text AS description,
    NULL::text AS phone,
    NULL::text AS email,
    NULL::text AS logo_url,
    'Office Team'::text AS contact_person
   FROM public.market_centers mc
  WHERE ("deletedAt" IS NULL);


--
-- Name: teams; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.teams (
    id integer NOT NULL,
    name text NOT NULL,
    "marketCenterId" integer NOT NULL,
    "statusId" integer NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "deletedAt" timestamp(3) without time zone
);


--
-- Name: public_teams_v; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.public_teams_v AS
 SELECT (id)::text AS id,
    lower(TRIM(BOTH '-'::text FROM regexp_replace(name, '[^a-zA-Z0-9]+'::text, '-'::text, 'g'::text))) AS slug,
    name,
    NULL::text AS description,
    NULL::text AS lead_name,
    NULL::text AS lead_photo_url,
    NULL::text AS phone,
    NULL::text AS email,
    ("marketCenterId")::text AS market_center_id
   FROM public.teams t
  WHERE ("deletedAt" IS NULL);


--
-- Name: referral_statuses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.referral_statuses (
    id integer NOT NULL,
    name text NOT NULL
);


--
-- Name: referral_statuses_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.referral_statuses_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: referral_statuses_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.referral_statuses_id_seq OWNED BY public.referral_statuses.id;


--
-- Name: referral_types; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.referral_types (
    id integer NOT NULL,
    name text NOT NULL
);


--
-- Name: referral_types_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.referral_types_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: referral_types_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.referral_types_id_seq OWNED BY public.referral_types.id;


--
-- Name: roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.roles (
    id text NOT NULL,
    name text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: suburbs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.suburbs (
    id integer NOT NULL,
    name text NOT NULL,
    "cityId" integer NOT NULL,
    "p24Id" integer,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: suburbs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.suburbs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: suburbs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.suburbs_id_seq OWNED BY public.suburbs.id;


--
-- Name: team_statuses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.team_statuses (
    id integer NOT NULL,
    name text NOT NULL
);


--
-- Name: team_statuses_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.team_statuses_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: team_statuses_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.team_statuses_id_seq OWNED BY public.team_statuses.id;


--
-- Name: teams_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.teams_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: teams_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.teams_id_seq OWNED BY public.teams.id;


--
-- Name: transaction_associate_payment_details; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.transaction_associate_payment_details (
    id integer NOT NULL,
    "transactionAssociateId" integer CONSTRAINT "transaction_associate_payment_d_transactionAssociateId_not_null" NOT NULL,
    "paymentAmount" numeric(65,30),
    "commissionPercentage" numeric(65,30),
    "paymentStatus" text,
    "transactionGCIBeforeFees" numeric(65,30),
    "productionRoyalties" numeric(65,30),
    "growthShare" numeric(65,30),
    "gciAfterFeesExclVAT" numeric(65,30),
    "capRemaining" numeric(65,30),
    "associateDollar" numeric(65,30),
    "teamDollar" numeric(65,30),
    "mcDollar" numeric(65,30),
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: transaction_associate_payment_details_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.transaction_associate_payment_details_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: transaction_associate_payment_details_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.transaction_associate_payment_details_id_seq OWNED BY public.transaction_associate_payment_details.id;


--
-- Name: transaction_associate_types; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.transaction_associate_types (
    id integer NOT NULL,
    name text NOT NULL
);


--
-- Name: transaction_associate_types_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.transaction_associate_types_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: transaction_associate_types_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.transaction_associate_types_id_seq OWNED BY public.transaction_associate_types.id;


--
-- Name: transaction_associates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.transaction_associates (
    id integer NOT NULL,
    "transactionId" integer NOT NULL,
    "associateId" integer NOT NULL,
    "marketCenterId" integer,
    "teamId" integer,
    "managementMarketCenterId" integer,
    "transactionAssociateTypeId" integer NOT NULL,
    "contactId" integer,
    "splitPercentage" numeric(65,30) DEFAULT 0 NOT NULL,
    "outsideAgency" text,
    "softDelete" boolean DEFAULT false NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: transaction_associates_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.transaction_associates_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: transaction_associates_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.transaction_associates_id_seq OWNED BY public.transaction_associates.id;


--
-- Name: transaction_bonds; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.transaction_bonds (
    id integer NOT NULL,
    "transactionId" integer NOT NULL,
    "bondAmount" numeric(65,30),
    "registrationNumber" text,
    "transactionFinancingTypeId" integer,
    "transactionFinancialInstitutionId" integer,
    "transactionFinancingChannelId" integer,
    "transferAttorneyId" integer,
    "bondAttorneyId" integer,
    "transactionFinancingChannelContactPersonId" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: transaction_bonds_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.transaction_bonds_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: transaction_bonds_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.transaction_bonds_id_seq OWNED BY public.transaction_bonds.id;


--
-- Name: transaction_contact_types; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.transaction_contact_types (
    id integer NOT NULL,
    name text NOT NULL
);


--
-- Name: transaction_contact_types_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.transaction_contact_types_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: transaction_contact_types_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.transaction_contact_types_id_seq OWNED BY public.transaction_contact_types.id;


--
-- Name: transaction_contacts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.transaction_contacts (
    id integer NOT NULL,
    "transactionId" integer NOT NULL,
    "contactId" integer NOT NULL,
    "transactionContactTypeId" integer NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: transaction_contacts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.transaction_contacts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: transaction_contacts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.transaction_contacts_id_seq OWNED BY public.transaction_contacts.id;


--
-- Name: transaction_descriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.transaction_descriptions (
    id integer NOT NULL,
    "transactionId" integer NOT NULL,
    "soldPrice" numeric(65,30) NOT NULL,
    "contractGCIExclVAT" numeric(65,30) NOT NULL,
    "transactionDate" timestamp(3) without time zone,
    "varianceSaleListPricePerc" numeric(65,30),
    "avgCommsPerc" numeric(65,30),
    "soldDate" timestamp(3) without time zone,
    "expectedDate" timestamp(3) without time zone,
    "paymentNotes" text,
    "returnNotes" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: transaction_descriptions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.transaction_descriptions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: transaction_descriptions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.transaction_descriptions_id_seq OWNED BY public.transaction_descriptions.id;


--
-- Name: transaction_documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.transaction_documents (
    id integer NOT NULL,
    "transactionId" integer NOT NULL,
    "documentId" text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: transaction_documents_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.transaction_documents_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: transaction_documents_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.transaction_documents_id_seq OWNED BY public.transaction_documents.id;


--
-- Name: transaction_financial_institutions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.transaction_financial_institutions (
    id integer NOT NULL,
    name text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: transaction_financial_institutions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.transaction_financial_institutions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: transaction_financial_institutions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.transaction_financial_institutions_id_seq OWNED BY public.transaction_financial_institutions.id;


--
-- Name: transaction_financing_channels; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.transaction_financing_channels (
    id integer NOT NULL,
    name text NOT NULL
);


--
-- Name: transaction_financing_channels_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.transaction_financing_channels_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: transaction_financing_channels_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.transaction_financing_channels_id_seq OWNED BY public.transaction_financing_channels.id;


--
-- Name: transaction_financing_types; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.transaction_financing_types (
    id integer NOT NULL,
    name text NOT NULL
);


--
-- Name: transaction_financing_types_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.transaction_financing_types_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: transaction_financing_types_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.transaction_financing_types_id_seq OWNED BY public.transaction_financing_types.id;


--
-- Name: transaction_notes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.transaction_notes (
    id integer NOT NULL,
    "transactionId" integer NOT NULL,
    content text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: transaction_notes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.transaction_notes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: transaction_notes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.transaction_notes_id_seq OWNED BY public.transaction_notes.id;


--
-- Name: transaction_statuses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.transaction_statuses (
    id integer NOT NULL,
    name text NOT NULL
);


--
-- Name: transaction_statuses_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.transaction_statuses_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: transaction_statuses_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.transaction_statuses_id_seq OWNED BY public.transaction_statuses.id;


--
-- Name: transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.transactions (
    id integer NOT NULL,
    "transactionNumber" text NOT NULL,
    "listingId" integer NOT NULL,
    "statusId" integer NOT NULL,
    "statusChangeDate" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "whoUpdatedId" text,
    "whenUpdated" timestamp(3) without time zone NOT NULL,
    "deletedAt" timestamp(3) without time zone
);


--
-- Name: transactions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.transactions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: transactions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.transactions_id_seq OWNED BY public.transactions.id;


--
-- Name: user_roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_roles (
    "userId" text NOT NULL,
    "roleId" text NOT NULL
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id text NOT NULL,
    email text NOT NULL,
    password text NOT NULL,
    "firstName" text NOT NULL,
    "lastName" text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "deletedAt" timestamp(3) without time zone
);


--
-- Name: associate_admin_market_centers_raw; Type: TABLE; Schema: staging; Owner: -
--

CREATE TABLE staging.associate_admin_market_centers_raw (
    source_associate_id text,
    source_market_center_id text
);


--
-- Name: associate_admin_teams_raw; Type: TABLE; Schema: staging; Owner: -
--

CREATE TABLE staging.associate_admin_teams_raw (
    source_associate_id text,
    source_team_id text
);


--
-- Name: associate_business_details_raw; Type: TABLE; Schema: staging; Owner: -
--

CREATE TABLE staging.associate_business_details_raw (
    source_associate_id text,
    kwuid text,
    growth_share_sponsor_source_id text,
    proposed_growth_share_sponsor text,
    temporary_growth_share_sponsor text,
    vested text,
    vesting_start_period text,
    listing_approval_required text,
    exclude_from_individual_reports text,
    source_market_center_id text,
    source_team_id text
);


--
-- Name: associate_commissions_raw; Type: TABLE; Schema: staging; Owner: -
--

CREATE TABLE staging.associate_commissions_raw (
    source_associate_id text,
    commission_split_pct text,
    total_cap_amount text,
    manual_cap text
);


--
-- Name: associate_dates_raw; Type: TABLE; Schema: staging; Owner: -
--

CREATE TABLE staging.associate_dates_raw (
    source_associate_id text,
    start_date text,
    end_date text,
    anniversary_date text,
    cap_date text
);


--
-- Name: associate_documents_raw; Type: TABLE; Schema: staging; Owner: -
--

CREATE TABLE staging.associate_documents_raw (
    id bigint NOT NULL,
    source_associate_id text,
    source_document_id text,
    source_associate_document_type_id text,
    associate_document_type text,
    document_url text,
    preview_url text,
    file_name text,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    soft_delete boolean DEFAULT false,
    loaded_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: associate_documents_raw_id_seq; Type: SEQUENCE; Schema: staging; Owner: -
--

CREATE SEQUENCE staging.associate_documents_raw_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: associate_documents_raw_id_seq; Type: SEQUENCE OWNED BY; Schema: staging; Owner: -
--

ALTER SEQUENCE staging.associate_documents_raw_id_seq OWNED BY staging.associate_documents_raw.id;


--
-- Name: associate_job_titles_raw; Type: TABLE; Schema: staging; Owner: -
--

CREATE TABLE staging.associate_job_titles_raw (
    source_associate_id text,
    job_title_name text
);


--
-- Name: associate_roles_raw; Type: TABLE; Schema: staging; Owner: -
--

CREATE TABLE staging.associate_roles_raw (
    source_associate_id text,
    role_name text
);


--
-- Name: associate_service_communities_raw; Type: TABLE; Schema: staging; Owner: -
--

CREATE TABLE staging.associate_service_communities_raw (
    source_associate_id text,
    service_community_name text
);


--
-- Name: associate_third_party_raw; Type: TABLE; Schema: staging; Owner: -
--

CREATE TABLE staging.associate_third_party_raw (
    source_associate_id text,
    feed_to_p24 text,
    p24_agent_id text,
    entegral_agent_id text,
    feed_to_entegral text,
    entegral_sync_message text
);


--
-- Name: associates_raw; Type: TABLE; Schema: staging; Owner: -
--

CREATE TABLE staging.associates_raw (
    id bigint NOT NULL,
    batch_id text NOT NULL,
    source_associate_id text,
    first_name text,
    last_name text,
    email text,
    status_name text,
    market_center_name text,
    team_name text,
    kwuid text,
    source_updated_at timestamp with time zone,
    raw_payload jsonb,
    loaded_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: associates_raw_id_seq; Type: SEQUENCE; Schema: staging; Owner: -
--

CREATE SEQUENCE staging.associates_raw_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: associates_raw_id_seq; Type: SEQUENCE OWNED BY; Schema: staging; Owner: -
--

ALTER SEQUENCE staging.associates_raw_id_seq OWNED BY staging.associates_raw.id;


--
-- Name: listing_associates; Type: TABLE; Schema: staging; Owner: -
--

CREATE TABLE staging.listing_associates (
    id bigint NOT NULL,
    source_listing_id text,
    source_associate_id text,
    associate_name text,
    is_primary boolean,
    loaded_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: listing_associates_id_seq; Type: SEQUENCE; Schema: staging; Owner: -
--

CREATE SEQUENCE staging.listing_associates_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: listing_associates_id_seq; Type: SEQUENCE OWNED BY; Schema: staging; Owner: -
--

ALTER SEQUENCE staging.listing_associates_id_seq OWNED BY staging.listing_associates.id;


--
-- Name: listing_documents_raw; Type: TABLE; Schema: staging; Owner: -
--

CREATE TABLE staging.listing_documents_raw (
    id bigint NOT NULL,
    source_listing_id text,
    source_document_id text,
    source_listing_document_type_id text,
    listing_document_type text,
    document_url text,
    preview_url text,
    file_name text,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    soft_delete boolean DEFAULT false,
    loaded_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: listing_documents_raw_id_seq; Type: SEQUENCE; Schema: staging; Owner: -
--

CREATE SEQUENCE staging.listing_documents_raw_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: listing_documents_raw_id_seq; Type: SEQUENCE OWNED BY; Schema: staging; Owner: -
--

ALTER SEQUENCE staging.listing_documents_raw_id_seq OWNED BY staging.listing_documents_raw.id;


--
-- Name: listing_features_raw; Type: TABLE; Schema: staging; Owner: -
--

CREATE TABLE staging.listing_features_raw (
    id bigint NOT NULL,
    source_listing_id text,
    source_feature_id text,
    feature_name text,
    source_feature_category_id text,
    soft_delete boolean DEFAULT false,
    updated_at timestamp with time zone,
    loaded_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: listing_features_raw_id_seq; Type: SEQUENCE; Schema: staging; Owner: -
--

CREATE SEQUENCE staging.listing_features_raw_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: listing_features_raw_id_seq; Type: SEQUENCE OWNED BY; Schema: staging; Owner: -
--

ALTER SEQUENCE staging.listing_features_raw_id_seq OWNED BY staging.listing_features_raw.id;


--
-- Name: listing_images_raw; Type: TABLE; Schema: staging; Owner: -
--

CREATE TABLE staging.listing_images_raw (
    id bigint NOT NULL,
    source_listing_id text,
    document_id text,
    image_url text,
    preview_url text,
    order_number integer,
    image_caption text,
    loaded_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: listing_images_raw_id_seq; Type: SEQUENCE; Schema: staging; Owner: -
--

CREATE SEQUENCE staging.listing_images_raw_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: listing_images_raw_id_seq; Type: SEQUENCE OWNED BY; Schema: staging; Owner: -
--

ALTER SEQUENCE staging.listing_images_raw_id_seq OWNED BY staging.listing_images_raw.id;


--
-- Name: listing_marketing_urls_raw; Type: TABLE; Schema: staging; Owner: -
--

CREATE TABLE staging.listing_marketing_urls_raw (
    id bigint NOT NULL,
    source_listing_id text,
    url text,
    marketing_url_type_id text,
    loaded_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: listing_marketing_urls_raw_id_seq; Type: SEQUENCE; Schema: staging; Owner: -
--

CREATE SEQUENCE staging.listing_marketing_urls_raw_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: listing_marketing_urls_raw_id_seq; Type: SEQUENCE OWNED BY; Schema: staging; Owner: -
--

ALTER SEQUENCE staging.listing_marketing_urls_raw_id_seq OWNED BY staging.listing_marketing_urls_raw.id;


--
-- Name: listing_p24_feed_items_raw; Type: TABLE; Schema: staging; Owner: -
--

CREATE TABLE staging.listing_p24_feed_items_raw (
    id bigint NOT NULL,
    source_listing_p24_feed_item_id text,
    source_listing_id text,
    source_status_id text,
    json_to_feed text,
    blob_url text,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    loaded_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: listing_p24_feed_items_raw_id_seq; Type: SEQUENCE; Schema: staging; Owner: -
--

CREATE SEQUENCE staging.listing_p24_feed_items_raw_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: listing_p24_feed_items_raw_id_seq; Type: SEQUENCE OWNED BY; Schema: staging; Owner: -
--

ALTER SEQUENCE staging.listing_p24_feed_items_raw_id_seq OWNED BY staging.listing_p24_feed_items_raw.id;


--
-- Name: listing_property_areas_raw; Type: TABLE; Schema: staging; Owner: -
--

CREATE TABLE staging.listing_property_areas_raw (
    id bigint NOT NULL,
    source_listing_id text,
    source_property_area_id text,
    property_area_name text,
    area_size numeric(18,4),
    source_measurement_type_id text,
    soft_delete boolean DEFAULT false,
    updated_at timestamp with time zone,
    loaded_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: listing_property_areas_raw_id_seq; Type: SEQUENCE; Schema: staging; Owner: -
--

CREATE SEQUENCE staging.listing_property_areas_raw_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: listing_property_areas_raw_id_seq; Type: SEQUENCE OWNED BY; Schema: staging; Owner: -
--

ALTER SEQUENCE staging.listing_property_areas_raw_id_seq OWNED BY staging.listing_property_areas_raw.id;


--
-- Name: listings_raw; Type: TABLE; Schema: staging; Owner: -
--

CREATE TABLE staging.listings_raw (
    id bigint NOT NULL,
    batch_id text NOT NULL,
    source_listing_id text,
    listing_number text,
    status_name text,
    market_center_name text,
    sale_or_rent text,
    street_number text,
    street_name text,
    suburb text,
    city text,
    province text,
    country text,
    price numeric(18,2),
    expiry_date timestamp with time zone,
    source_updated_at timestamp with time zone,
    property_title text,
    short_title text,
    property_description text,
    listing_images_json jsonb,
    raw_payload jsonb,
    loaded_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: listings_raw_id_seq; Type: SEQUENCE; Schema: staging; Owner: -
--

CREATE SEQUENCE staging.listings_raw_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: listings_raw_id_seq; Type: SEQUENCE OWNED BY; Schema: staging; Owner: -
--

ALTER SEQUENCE staging.listings_raw_id_seq OWNED BY staging.listings_raw.id;


--
-- Name: market_centers_raw; Type: TABLE; Schema: staging; Owner: -
--

CREATE TABLE staging.market_centers_raw (
    id bigint NOT NULL,
    batch_id text NOT NULL,
    source_market_center_id text,
    name text,
    status_name text,
    frontdoor_id text,
    source_updated_at timestamp with time zone,
    raw_payload jsonb,
    loaded_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: market_centers_raw_id_seq; Type: SEQUENCE; Schema: staging; Owner: -
--

CREATE SEQUENCE staging.market_centers_raw_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: market_centers_raw_id_seq; Type: SEQUENCE OWNED BY; Schema: staging; Owner: -
--

ALTER SEQUENCE staging.market_centers_raw_id_seq OWNED BY staging.market_centers_raw.id;


--
-- Name: portal_fields_raw; Type: TABLE; Schema: staging; Owner: -
--

CREATE TABLE staging.portal_fields_raw (
    source_listing_id text,
    listing_number text,
    display_address_on_website text,
    feed_to_property24 text,
    property24_ref1 text,
    feed_to_entegral text,
    feed_to_private_property text,
    private_property_ref1 text,
    feed_to_kww text,
    kww_property_reference text
);


--
-- Name: portal_fields_raw_norm; Type: TABLE; Schema: staging; Owner: -
--

CREATE TABLE staging.portal_fields_raw_norm (
    source_listing_id text,
    listing_number text,
    display_address_on_website boolean,
    feed_to_property24 boolean,
    property24_ref1 text,
    feed_to_entegral boolean,
    feed_to_private_property boolean,
    private_property_ref1 text,
    feed_to_kww boolean,
    kww_property_reference text
);


--
-- Name: ssms_listing_area_features_flat_raw; Type: TABLE; Schema: staging; Owner: -
--

CREATE TABLE staging.ssms_listing_area_features_flat_raw (
    id bigint NOT NULL,
    source_listing_id text,
    listing_number text,
    listing_property_area_id text,
    listing_property_area_type_id text,
    area_name text,
    feature_name text,
    loaded_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ssms_listing_area_features_flat_raw_id_seq; Type: SEQUENCE; Schema: staging; Owner: -
--

CREATE SEQUENCE staging.ssms_listing_area_features_flat_raw_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ssms_listing_area_features_flat_raw_id_seq; Type: SEQUENCE OWNED BY; Schema: staging; Owner: -
--

ALTER SEQUENCE staging.ssms_listing_area_features_flat_raw_id_seq OWNED BY staging.ssms_listing_area_features_flat_raw.id;


--
-- Name: ssms_listing_building_area_features_raw; Type: TABLE; Schema: staging; Owner: -
--

CREATE TABLE staging.ssms_listing_building_area_features_raw (
    id bigint NOT NULL,
    source_listing_id text,
    listing_number text,
    listing_building_info_id text,
    area_name text,
    feature_name text,
    feature_p24_tag text,
    loaded_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ssms_listing_building_area_features_raw_id_seq; Type: SEQUENCE; Schema: staging; Owner: -
--

CREATE SEQUENCE staging.ssms_listing_building_area_features_raw_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ssms_listing_building_area_features_raw_id_seq; Type: SEQUENCE OWNED BY; Schema: staging; Owner: -
--

ALTER SEQUENCE staging.ssms_listing_building_area_features_raw_id_seq OWNED BY staging.ssms_listing_building_area_features_raw.id;


--
-- Name: ssms_listing_building_info_internet_raw; Type: TABLE; Schema: staging; Owner: -
--

CREATE TABLE staging.ssms_listing_building_info_internet_raw (
    id bigint NOT NULL,
    source_listing_id text,
    listing_number text,
    listing_building_info_id text,
    adsl boolean,
    dialup boolean,
    fibre boolean,
    fixed_wimax boolean,
    isdn boolean,
    satellite boolean,
    loaded_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ssms_listing_building_info_internet_raw_id_seq; Type: SEQUENCE; Schema: staging; Owner: -
--

CREATE SEQUENCE staging.ssms_listing_building_info_internet_raw_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ssms_listing_building_info_internet_raw_id_seq; Type: SEQUENCE OWNED BY; Schema: staging; Owner: -
--

ALTER SEQUENCE staging.ssms_listing_building_info_internet_raw_id_seq OWNED BY staging.ssms_listing_building_info_internet_raw.id;


--
-- Name: ssms_listing_building_info_public_transport_raw; Type: TABLE; Schema: staging; Owner: -
--

CREATE TABLE staging.ssms_listing_building_info_public_transport_raw (
    id bigint NOT NULL,
    source_listing_id text,
    listing_number text,
    listing_building_info_id text,
    has_nearby_bus_service boolean,
    has_nearby_minibus_taxi_service boolean,
    has_nearby_train_service boolean,
    loaded_at timestamp with time zone DEFAULT now() CONSTRAINT ssms_listing_building_info_public_transport__loaded_at_not_null NOT NULL
);


--
-- Name: ssms_listing_building_info_public_transport_raw_id_seq; Type: SEQUENCE; Schema: staging; Owner: -
--

CREATE SEQUENCE staging.ssms_listing_building_info_public_transport_raw_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ssms_listing_building_info_public_transport_raw_id_seq; Type: SEQUENCE OWNED BY; Schema: staging; Owner: -
--

ALTER SEQUENCE staging.ssms_listing_building_info_public_transport_raw_id_seq OWNED BY staging.ssms_listing_building_info_public_transport_raw.id;


--
-- Name: ssms_listing_building_info_raw; Type: TABLE; Schema: staging; Owner: -
--

CREATE TABLE staging.ssms_listing_building_info_raw (
    id bigint NOT NULL,
    source_listing_id text,
    listing_number text,
    listing_building_info_id text,
    erf_size text,
    floor_area text,
    number_of_floors text,
    construction_year text,
    height_restriction text,
    furnished_property boolean,
    has_flatlet boolean,
    pet_friendly boolean,
    out_building_size text,
    has_backup_water boolean,
    has_generator boolean,
    has_standalone_building boolean,
    wheelchair_accessible boolean,
    zoning_type text,
    loaded_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ssms_listing_building_info_raw_id_seq; Type: SEQUENCE; Schema: staging; Owner: -
--

CREATE SEQUENCE staging.ssms_listing_building_info_raw_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ssms_listing_building_info_raw_id_seq; Type: SEQUENCE OWNED BY; Schema: staging; Owner: -
--

ALTER SEQUENCE staging.ssms_listing_building_info_raw_id_seq OWNED BY staging.ssms_listing_building_info_raw.id;


--
-- Name: ssms_listing_building_info_sustainability_raw; Type: TABLE; Schema: staging; Owner: -
--

CREATE TABLE staging.ssms_listing_building_info_sustainability_raw (
    id bigint NOT NULL,
    source_listing_id text,
    listing_number text,
    listing_building_info_id text,
    has_solar_panels boolean,
    has_solar_geyser boolean,
    has_gas_geyser boolean,
    has_water_tank boolean,
    has_borehole boolean,
    has_backup_battery_or_inverter boolean,
    loaded_at timestamp with time zone DEFAULT now() CONSTRAINT ssms_listing_building_info_sustainability_ra_loaded_at_not_null NOT NULL
);


--
-- Name: ssms_listing_building_info_sustainability_raw_id_seq; Type: SEQUENCE; Schema: staging; Owner: -
--

CREATE SEQUENCE staging.ssms_listing_building_info_sustainability_raw_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ssms_listing_building_info_sustainability_raw_id_seq; Type: SEQUENCE OWNED BY; Schema: staging; Owner: -
--

ALTER SEQUENCE staging.ssms_listing_building_info_sustainability_raw_id_seq OWNED BY staging.ssms_listing_building_info_sustainability_raw.id;


--
-- Name: ssms_listing_details_raw; Type: TABLE; Schema: staging; Owner: -
--

CREATE TABLE staging.ssms_listing_details_raw (
    id bigint NOT NULL,
    source_listing_id text,
    listing_number text,
    status_name text,
    listing_status_tag text,
    sale_or_rent text,
    list_date text,
    reduced_date text,
    reduced_price text,
    property24_reference text,
    private_property_reference text,
    kww_sync_message text,
    p24_sync_message text,
    private_property_sync_message text,
    entegral_sync_message text,
    erf_number text,
    erf_size text,
    floor_area text,
    has_flatlet boolean,
    kww_property_reference text,
    marketing_urls text,
    document_urls text,
    building_feature text,
    loaded_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ssms_listing_details_raw_id_seq; Type: SEQUENCE; Schema: staging; Owner: -
--

CREATE SEQUENCE staging.ssms_listing_details_raw_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ssms_listing_details_raw_id_seq; Type: SEQUENCE OWNED BY; Schema: staging; Owner: -
--

ALTER SEQUENCE staging.ssms_listing_details_raw_id_seq OWNED BY staging.ssms_listing_details_raw.id;


--
-- Name: ssms_listing_property_area_features_raw; Type: TABLE; Schema: staging; Owner: -
--

CREATE TABLE staging.ssms_listing_property_area_features_raw (
    id bigint NOT NULL,
    source_listing_id text,
    listing_number text,
    listing_property_area_id text,
    listing_property_area_type_id text,
    area_name text,
    feature_name text,
    feature_p24_tag text,
    loaded_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ssms_listing_property_area_features_raw_id_seq; Type: SEQUENCE; Schema: staging; Owner: -
--

CREATE SEQUENCE staging.ssms_listing_property_area_features_raw_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ssms_listing_property_area_features_raw_id_seq; Type: SEQUENCE OWNED BY; Schema: staging; Owner: -
--

ALTER SEQUENCE staging.ssms_listing_property_area_features_raw_id_seq OWNED BY staging.ssms_listing_property_area_features_raw.id;


--
-- Name: ssms_listing_property_areas_raw; Type: TABLE; Schema: staging; Owner: -
--

CREATE TABLE staging.ssms_listing_property_areas_raw (
    id bigint NOT NULL,
    source_listing_id text,
    listing_number text,
    listing_property_area_id text,
    listing_property_area_type_id text,
    area_name text,
    area_type_name text,
    area_count text,
    area_size text,
    area_description text,
    loaded_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ssms_listing_property_areas_raw_id_seq; Type: SEQUENCE; Schema: staging; Owner: -
--

CREATE SEQUENCE staging.ssms_listing_property_areas_raw_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ssms_listing_property_areas_raw_id_seq; Type: SEQUENCE OWNED BY; Schema: staging; Owner: -
--

ALTER SEQUENCE staging.ssms_listing_property_areas_raw_id_seq OWNED BY staging.ssms_listing_property_areas_raw.id;


--
-- Name: team_associate_comm_raw; Type: TABLE; Schema: staging; Owner: -
--

CREATE TABLE staging.team_associate_comm_raw (
    source_id text,
    source_team_id text,
    has_individual_cap text,
    associate_default_cap text,
    associate_default_split text,
    productivity_coach text
);


--
-- Name: team_caps_raw; Type: TABLE; Schema: staging; Owner: -
--

CREATE TABLE staging.team_caps_raw (
    source_cap_id text,
    source_team_id text,
    commission_split_to_team text,
    team_cap_amount text,
    manual_cap text,
    cap_year text,
    source_updated_at text
);


--
-- Name: team_dates_raw; Type: TABLE; Schema: staging; Owner: -
--

CREATE TABLE staging.team_dates_raw (
    source_id text,
    source_team_id text,
    open_date text,
    close_date text,
    cap_date text,
    anniversary_date text,
    anniversary_comment text
);


--
-- Name: team_notes_raw; Type: TABLE; Schema: staging; Owner: -
--

CREATE TABLE staging.team_notes_raw (
    source_id text,
    source_team_id text,
    note_text text,
    note_type text,
    created_by text,
    created_at text
);


--
-- Name: team_third_party_raw; Type: TABLE; Schema: staging; Owner: -
--

CREATE TABLE staging.team_third_party_raw (
    source_id text,
    source_team_id text,
    third_party_name text,
    external_team_id text,
    is_active text,
    sync_message text
);


--
-- Name: teams_raw; Type: TABLE; Schema: staging; Owner: -
--

CREATE TABLE staging.teams_raw (
    id bigint NOT NULL,
    batch_id text NOT NULL,
    source_team_id text,
    source_market_center_id text,
    name text,
    status_name text,
    source_updated_at timestamp with time zone,
    raw_payload jsonb,
    loaded_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: teams_raw_id_seq; Type: SEQUENCE; Schema: staging; Owner: -
--

CREATE SEQUENCE staging.teams_raw_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: teams_raw_id_seq; Type: SEQUENCE OWNED BY; Schema: staging; Owner: -
--

ALTER SEQUENCE staging.teams_raw_id_seq OWNED BY staging.teams_raw.id;


--
-- Name: transaction_agents; Type: TABLE; Schema: staging; Owner: -
--

CREATE TABLE staging.transaction_agents (
    id bigint NOT NULL,
    transaction_id bigint NOT NULL,
    source_associate_id text,
    associate_name text,
    split_percentage numeric(10,4),
    agent_type text,
    sort_order integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    outside_agency boolean DEFAULT false,
    market_center_id_source text,
    team_id_source text,
    management_mc_id_source text
);


--
-- Name: transaction_agents_id_seq; Type: SEQUENCE; Schema: staging; Owner: -
--

CREATE SEQUENCE staging.transaction_agents_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: transaction_agents_id_seq; Type: SEQUENCE OWNED BY; Schema: staging; Owner: -
--

ALTER SEQUENCE staging.transaction_agents_id_seq OWNED BY staging.transaction_agents.id;


--
-- Name: transaction_associate_payment_details; Type: TABLE; Schema: staging; Owner: -
--

CREATE TABLE staging.transaction_associate_payment_details (
    id bigint NOT NULL,
    source_transaction_id text,
    source_associate_id text,
    split_percentage numeric(10,4),
    gci_before_fees numeric(18,2),
    production_royalties numeric(18,2),
    growth_share numeric(18,2),
    gci_after_fees_excl_vat numeric(18,2),
    cap_remaining numeric(18,2),
    associate_dollar numeric(18,2),
    team_dollar numeric(18,2),
    mc_dollar numeric(18,2),
    loaded_at timestamp with time zone DEFAULT now() NOT NULL,
    source_transaction_associate_id text
);


--
-- Name: transaction_associate_payment_details_id_seq; Type: SEQUENCE; Schema: staging; Owner: -
--

CREATE SEQUENCE staging.transaction_associate_payment_details_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: transaction_associate_payment_details_id_seq; Type: SEQUENCE OWNED BY; Schema: staging; Owner: -
--

ALTER SEQUENCE staging.transaction_associate_payment_details_id_seq OWNED BY staging.transaction_associate_payment_details.id;


--
-- Name: transaction_bonds; Type: TABLE; Schema: staging; Owner: -
--

CREATE TABLE staging.transaction_bonds (
    id bigint NOT NULL,
    source_transaction_id text,
    bond_amount numeric(18,2),
    bond_due_date date,
    bond_originator text,
    other_financial_institution text,
    financing_type text,
    financial_institution text,
    financing_channel text,
    transfer_attorney text,
    bond_attorney text,
    loaded_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: transaction_bonds_id_seq; Type: SEQUENCE; Schema: staging; Owner: -
--

CREATE SEQUENCE staging.transaction_bonds_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: transaction_bonds_id_seq; Type: SEQUENCE OWNED BY; Schema: staging; Owner: -
--

ALTER SEQUENCE staging.transaction_bonds_id_seq OWNED BY staging.transaction_bonds.id;


--
-- Name: transaction_contacts_raw; Type: TABLE; Schema: staging; Owner: -
--

CREATE TABLE staging.transaction_contacts_raw (
    id bigint NOT NULL,
    source_transaction_id text,
    source_contact_id text,
    source_transaction_contact_type_id text,
    transaction_contact_type text,
    contact_full_name text,
    first_name text,
    last_name text,
    email text,
    phone_number text,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    soft_delete boolean DEFAULT false,
    loaded_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: transaction_contacts_raw_id_seq; Type: SEQUENCE; Schema: staging; Owner: -
--

CREATE SEQUENCE staging.transaction_contacts_raw_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: transaction_contacts_raw_id_seq; Type: SEQUENCE OWNED BY; Schema: staging; Owner: -
--

ALTER SEQUENCE staging.transaction_contacts_raw_id_seq OWNED BY staging.transaction_contacts_raw.id;


--
-- Name: transaction_documents_raw; Type: TABLE; Schema: staging; Owner: -
--

CREATE TABLE staging.transaction_documents_raw (
    id bigint NOT NULL,
    source_transaction_id text,
    source_document_id text,
    source_transaction_document_type_id text,
    transaction_document_type text,
    document_url text,
    preview_url text,
    file_name text,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    soft_delete boolean DEFAULT false,
    loaded_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: transaction_documents_raw_id_seq; Type: SEQUENCE; Schema: staging; Owner: -
--

CREATE SEQUENCE staging.transaction_documents_raw_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: transaction_documents_raw_id_seq; Type: SEQUENCE OWNED BY; Schema: staging; Owner: -
--

ALTER SEQUENCE staging.transaction_documents_raw_id_seq OWNED BY staging.transaction_documents_raw.id;


--
-- Name: transaction_notes; Type: TABLE; Schema: staging; Owner: -
--

CREATE TABLE staging.transaction_notes (
    id bigint NOT NULL,
    source_transaction_id text,
    note_text text,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    loaded_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: transaction_notes_id_seq; Type: SEQUENCE; Schema: staging; Owner: -
--

CREATE SEQUENCE staging.transaction_notes_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: transaction_notes_id_seq; Type: SEQUENCE OWNED BY; Schema: staging; Owner: -
--

ALTER SEQUENCE staging.transaction_notes_id_seq OWNED BY staging.transaction_notes.id;


--
-- Name: transactions_raw; Type: TABLE; Schema: staging; Owner: -
--

CREATE TABLE staging.transactions_raw (
    id bigint NOT NULL,
    batch_id text NOT NULL,
    source_transaction_id text,
    transaction_number text,
    source_market_center_id text,
    market_center_name text,
    source_associate_id text,
    associate_name text,
    transaction_status text,
    source_listing_id text,
    listing_number text,
    list_date timestamp with time zone,
    transaction_date timestamp with time zone,
    status_change_date timestamp with time zone,
    expected_date timestamp with time zone,
    transaction_type text,
    address text,
    suburb text,
    city text,
    sales_price numeric(18,2),
    list_price numeric(18,2),
    gci_excl_vat numeric(18,2),
    split_percentage numeric(10,4),
    net_comm numeric(18,2),
    total_gci numeric(18,2),
    sale_type text,
    agent_type text,
    buyer text,
    seller text,
    raw_payload jsonb,
    loaded_at timestamp with time zone DEFAULT now() NOT NULL,
    payment_notes text,
    return_notes text,
    source_team_id text,
    team_name text,
    current_source_market_center_id text,
    current_market_center_name text,
    current_source_team_id text,
    current_team_name text,
    listing_office_name text,
    variance_per numeric(18,6),
    contract_gci_excl_vat numeric(18,2),
    avg_comms_per numeric(18,6),
    transaction_gci_excl_vat numeric(18,2),
    growth_share numeric(18,2),
    production_royalties numeric(18,2),
    cap_remaining numeric(18,2),
    associate_dollar numeric(18,2),
    mc_dollar numeric(18,2),
    company_dollar numeric(18,2),
    team_dollar numeric(18,2),
    transfer_attorney text,
    ta_mobile_phone text,
    ta_email text,
    bond_attorney_contact_id text,
    bond_attorney text,
    ba_mobile_phone text,
    ba_email text,
    bond_originator text,
    bond_due_date timestamp with time zone,
    bond_amount numeric(18,2),
    transaction_financial_institution_id text,
    transaction_financial_institution text,
    financial_institution_other text,
    transaction_financing_type_id text,
    transaction_financing_type text,
    all_parties_invoiced text
);


--
-- Name: transactions_raw_id_seq; Type: SEQUENCE; Schema: staging; Owner: -
--

CREATE SEQUENCE staging.transactions_raw_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: transactions_raw_id_seq; Type: SEQUENCE OWNED BY; Schema: staging; Owner: -
--

ALTER SEQUENCE staging.transactions_raw_id_seq OWNED BY staging.transactions_raw.id;


--
-- Name: rental_audit_log id; Type: DEFAULT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.rental_audit_log ALTER COLUMN id SET DEFAULT nextval('app.rental_audit_log_id_seq'::regclass);


--
-- Name: rental_documents id; Type: DEFAULT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.rental_documents ALTER COLUMN id SET DEFAULT nextval('app.rental_documents_id_seq'::regclass);


--
-- Name: rental_participants id; Type: DEFAULT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.rental_participants ALTER COLUMN id SET DEFAULT nextval('app.rental_participants_id_seq'::regclass);


--
-- Name: rental_payment_schedule id; Type: DEFAULT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.rental_payment_schedule ALTER COLUMN id SET DEFAULT nextval('app.rental_payment_schedule_id_seq'::regclass);


--
-- Name: rentals id; Type: DEFAULT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.rentals ALTER COLUMN id SET DEFAULT nextval('app.rentals_id_seq'::regclass);


--
-- Name: agent_deregistration_log id; Type: DEFAULT; Schema: migration; Owner: -
--

ALTER TABLE ONLY migration.agent_deregistration_log ALTER COLUMN id SET DEFAULT nextval('migration.agent_deregistration_log_id_seq'::regclass);


--
-- Name: agent_reactivation_log id; Type: DEFAULT; Schema: migration; Owner: -
--

ALTER TABLE ONLY migration.agent_reactivation_log ALTER COLUMN id SET DEFAULT nextval('migration.agent_reactivation_log_id_seq'::regclass);


--
-- Name: associate_admin_market_centers id; Type: DEFAULT; Schema: migration; Owner: -
--

ALTER TABLE ONLY migration.associate_admin_market_centers ALTER COLUMN id SET DEFAULT nextval('migration.associate_admin_market_centers_id_seq'::regclass);


--
-- Name: associate_admin_teams id; Type: DEFAULT; Schema: migration; Owner: -
--

ALTER TABLE ONLY migration.associate_admin_teams ALTER COLUMN id SET DEFAULT nextval('migration.associate_admin_teams_id_seq'::regclass);


--
-- Name: associate_documents id; Type: DEFAULT; Schema: migration; Owner: -
--

ALTER TABLE ONLY migration.associate_documents ALTER COLUMN id SET DEFAULT nextval('migration.associate_documents_id_seq'::regclass);


--
-- Name: associate_job_titles id; Type: DEFAULT; Schema: migration; Owner: -
--

ALTER TABLE ONLY migration.associate_job_titles ALTER COLUMN id SET DEFAULT nextval('migration.associate_job_titles_id_seq'::regclass);


--
-- Name: associate_notes id; Type: DEFAULT; Schema: migration; Owner: -
--

ALTER TABLE ONLY migration.associate_notes ALTER COLUMN id SET DEFAULT nextval('migration.associate_notes_id_seq'::regclass);


--
-- Name: associate_roles id; Type: DEFAULT; Schema: migration; Owner: -
--

ALTER TABLE ONLY migration.associate_roles ALTER COLUMN id SET DEFAULT nextval('migration.associate_roles_id_seq'::regclass);


--
-- Name: associate_service_communities id; Type: DEFAULT; Schema: migration; Owner: -
--

ALTER TABLE ONLY migration.associate_service_communities ALTER COLUMN id SET DEFAULT nextval('migration.associate_service_communities_id_seq'::regclass);


--
-- Name: associate_social_media id; Type: DEFAULT; Schema: migration; Owner: -
--

ALTER TABLE ONLY migration.associate_social_media ALTER COLUMN id SET DEFAULT nextval('migration.associate_social_media_id_seq'::regclass);


--
-- Name: core_associates id; Type: DEFAULT; Schema: migration; Owner: -
--

ALTER TABLE ONLY migration.core_associates ALTER COLUMN id SET DEFAULT nextval('migration.core_associates_id_seq'::regclass);


--
-- Name: core_listings id; Type: DEFAULT; Schema: migration; Owner: -
--

ALTER TABLE ONLY migration.core_listings ALTER COLUMN id SET DEFAULT nextval('migration.core_listings_id_seq'::regclass);


--
-- Name: core_market_centers id; Type: DEFAULT; Schema: migration; Owner: -
--

ALTER TABLE ONLY migration.core_market_centers ALTER COLUMN id SET DEFAULT nextval('migration.core_market_centers_id_seq'::regclass);


--
-- Name: core_teams id; Type: DEFAULT; Schema: migration; Owner: -
--

ALTER TABLE ONLY migration.core_teams ALTER COLUMN id SET DEFAULT nextval('migration.core_teams_id_seq'::regclass);


--
-- Name: core_transactions id; Type: DEFAULT; Schema: migration; Owner: -
--

ALTER TABLE ONLY migration.core_transactions ALTER COLUMN id SET DEFAULT nextval('migration.core_transactions_id_seq'::regclass);


--
-- Name: in_app_notifications id; Type: DEFAULT; Schema: migration; Owner: -
--

ALTER TABLE ONLY migration.in_app_notifications ALTER COLUMN id SET DEFAULT nextval('migration.in_app_notifications_id_seq'::regclass);


--
-- Name: listing_agents id; Type: DEFAULT; Schema: migration; Owner: -
--

ALTER TABLE ONLY migration.listing_agents ALTER COLUMN id SET DEFAULT nextval('migration.listing_agents_id_seq'::regclass);


--
-- Name: listing_approval_requests id; Type: DEFAULT; Schema: migration; Owner: -
--

ALTER TABLE ONLY migration.listing_approval_requests ALTER COLUMN id SET DEFAULT nextval('migration.listing_approval_requests_id_seq'::regclass);


--
-- Name: listing_contacts id; Type: DEFAULT; Schema: migration; Owner: -
--

ALTER TABLE ONLY migration.listing_contacts ALTER COLUMN id SET DEFAULT nextval('migration.listing_contacts_id_seq'::regclass);


--
-- Name: listing_features id; Type: DEFAULT; Schema: migration; Owner: -
--

ALTER TABLE ONLY migration.listing_features ALTER COLUMN id SET DEFAULT nextval('migration.listing_features_id_seq'::regclass);


--
-- Name: listing_images id; Type: DEFAULT; Schema: migration; Owner: -
--

ALTER TABLE ONLY migration.listing_images ALTER COLUMN id SET DEFAULT nextval('migration.listing_images_id_seq'::regclass);


--
-- Name: listing_mandate_documents id; Type: DEFAULT; Schema: migration; Owner: -
--

ALTER TABLE ONLY migration.listing_mandate_documents ALTER COLUMN id SET DEFAULT nextval('migration.listing_mandate_documents_id_seq'::regclass);


--
-- Name: listing_marketing_urls id; Type: DEFAULT; Schema: migration; Owner: -
--

ALTER TABLE ONLY migration.listing_marketing_urls ALTER COLUMN id SET DEFAULT nextval('migration.listing_marketing_urls_id_seq'::regclass);


--
-- Name: listing_open_house id; Type: DEFAULT; Schema: migration; Owner: -
--

ALTER TABLE ONLY migration.listing_open_house ALTER COLUMN id SET DEFAULT nextval('migration.listing_open_house_id_seq'::regclass);


--
-- Name: listing_property_areas id; Type: DEFAULT; Schema: migration; Owner: -
--

ALTER TABLE ONLY migration.listing_property_areas ALTER COLUMN id SET DEFAULT nextval('migration.listing_property_areas_id_seq'::regclass);


--
-- Name: listing_show_times id; Type: DEFAULT; Schema: migration; Owner: -
--

ALTER TABLE ONLY migration.listing_show_times ALTER COLUMN id SET DEFAULT nextval('migration.listing_show_times_id_seq'::regclass);


--
-- Name: listing_transfer_log id; Type: DEFAULT; Schema: migration; Owner: -
--

ALTER TABLE ONLY migration.listing_transfer_log ALTER COLUMN id SET DEFAULT nextval('migration.listing_transfer_log_id_seq'::regclass);


--
-- Name: load_rejections id; Type: DEFAULT; Schema: migration; Owner: -
--

ALTER TABLE ONLY migration.load_rejections ALTER COLUMN id SET DEFAULT nextval('migration.load_rejections_id_seq'::regclass);


--
-- Name: market_center_notes id; Type: DEFAULT; Schema: migration; Owner: -
--

ALTER TABLE ONLY migration.market_center_notes ALTER COLUMN id SET DEFAULT nextval('migration.market_center_notes_id_seq'::regclass);


--
-- Name: mc_document_hub id; Type: DEFAULT; Schema: migration; Owner: -
--

ALTER TABLE ONLY migration.mc_document_hub ALTER COLUMN id SET DEFAULT nextval('migration.mc_document_hub_id_seq'::regclass);


--
-- Name: outside_agency_contacts id; Type: DEFAULT; Schema: migration; Owner: -
--

ALTER TABLE ONLY migration.outside_agency_contacts ALTER COLUMN id SET DEFAULT nextval('migration.outside_agency_contacts_id_seq'::regclass);


--
-- Name: team_associate_commissions id; Type: DEFAULT; Schema: migration; Owner: -
--

ALTER TABLE ONLY migration.team_associate_commissions ALTER COLUMN id SET DEFAULT nextval('migration.team_associate_commissions_id_seq'::regclass);


--
-- Name: team_cap_history id; Type: DEFAULT; Schema: migration; Owner: -
--

ALTER TABLE ONLY migration.team_cap_history ALTER COLUMN id SET DEFAULT nextval('migration.team_cap_history_id_seq'::regclass);


--
-- Name: team_caps id; Type: DEFAULT; Schema: migration; Owner: -
--

ALTER TABLE ONLY migration.team_caps ALTER COLUMN id SET DEFAULT nextval('migration.team_caps_id_seq'::regclass);


--
-- Name: team_dates id; Type: DEFAULT; Schema: migration; Owner: -
--

ALTER TABLE ONLY migration.team_dates ALTER COLUMN id SET DEFAULT nextval('migration.team_dates_id_seq'::regclass);


--
-- Name: team_notes id; Type: DEFAULT; Schema: migration; Owner: -
--

ALTER TABLE ONLY migration.team_notes ALTER COLUMN id SET DEFAULT nextval('migration.team_notes_id_seq'::regclass);


--
-- Name: team_portal_settings id; Type: DEFAULT; Schema: migration; Owner: -
--

ALTER TABLE ONLY migration.team_portal_settings ALTER COLUMN id SET DEFAULT nextval('migration.team_portal_settings_id_seq'::regclass);


--
-- Name: transaction_agent_calculations id; Type: DEFAULT; Schema: migration; Owner: -
--

ALTER TABLE ONLY migration.transaction_agent_calculations ALTER COLUMN id SET DEFAULT nextval('migration.transaction_agent_calculations_id_seq'::regclass);


--
-- Name: transaction_agents id; Type: DEFAULT; Schema: migration; Owner: -
--

ALTER TABLE ONLY migration.transaction_agents ALTER COLUMN id SET DEFAULT nextval('migration.transaction_agents_id_seq'::regclass);


--
-- Name: transaction_documents id; Type: DEFAULT; Schema: migration; Owner: -
--

ALTER TABLE ONLY migration.transaction_documents ALTER COLUMN id SET DEFAULT nextval('migration.transaction_documents_id_seq'::regclass);


--
-- Name: transaction_status_history id; Type: DEFAULT; Schema: migration; Owner: -
--

ALTER TABLE ONLY migration.transaction_status_history ALTER COLUMN id SET DEFAULT nextval('migration.transaction_status_history_id_seq'::regclass);


--
-- Name: addresses id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.addresses ALTER COLUMN id SET DEFAULT nextval('public.addresses_id_seq'::regclass);


--
-- Name: app_users id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_users ALTER COLUMN id SET DEFAULT nextval('public.app_users_id_seq'::regclass);


--
-- Name: associate_business_details id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.associate_business_details ALTER COLUMN id SET DEFAULT nextval('public.associate_business_details_id_seq'::regclass);


--
-- Name: associate_contact_details id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.associate_contact_details ALTER COLUMN id SET DEFAULT nextval('public.associate_contact_details_id_seq'::regclass);


--
-- Name: associate_statuses id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.associate_statuses ALTER COLUMN id SET DEFAULT nextval('public.associate_statuses_id_seq'::regclass);


--
-- Name: associate_third_party_integrations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.associate_third_party_integrations ALTER COLUMN id SET DEFAULT nextval('public.associate_third_party_integrations_id_seq'::regclass);


--
-- Name: associate_transfer_statuses id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.associate_transfer_statuses ALTER COLUMN id SET DEFAULT nextval('public.associate_transfer_statuses_id_seq'::regclass);


--
-- Name: associate_transfers id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.associate_transfers ALTER COLUMN id SET DEFAULT nextval('public.associate_transfers_id_seq'::regclass);


--
-- Name: associates id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.associates ALTER COLUMN id SET DEFAULT nextval('public.associates_id_seq'::regclass);


--
-- Name: cities id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cities ALTER COLUMN id SET DEFAULT nextval('public.cities_id_seq'::regclass);


--
-- Name: cma_documents id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cma_documents ALTER COLUMN id SET DEFAULT nextval('public.cma_documents_id_seq'::regclass);


--
-- Name: contacts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contacts ALTER COLUMN id SET DEFAULT nextval('public.contacts_id_seq'::regclass);


--
-- Name: countries id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.countries ALTER COLUMN id SET DEFAULT nextval('public.countries_id_seq'::regclass);


--
-- Name: email_types id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_types ALTER COLUMN id SET DEFAULT nextval('public.email_types_id_seq'::regclass);


--
-- Name: icon_types id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.icon_types ALTER COLUMN id SET DEFAULT nextval('public.icon_types_id_seq'::regclass);


--
-- Name: listing_associate_types id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listing_associate_types ALTER COLUMN id SET DEFAULT nextval('public.listing_associate_types_id_seq'::regclass);


--
-- Name: listing_associates id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listing_associates ALTER COLUMN id SET DEFAULT nextval('public.listing_associates_id_seq'::regclass);


--
-- Name: listing_building_area_feature_types id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listing_building_area_feature_types ALTER COLUMN id SET DEFAULT nextval('public.listing_building_area_feature_types_id_seq'::regclass);


--
-- Name: listing_building_area_features id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listing_building_area_features ALTER COLUMN id SET DEFAULT nextval('public.listing_building_area_features_id_seq'::regclass);


--
-- Name: listing_building_infos id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listing_building_infos ALTER COLUMN id SET DEFAULT nextval('public.listing_building_infos_id_seq'::regclass);


--
-- Name: listing_building_zoning_types id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listing_building_zoning_types ALTER COLUMN id SET DEFAULT nextval('public.listing_building_zoning_types_id_seq'::regclass);


--
-- Name: listing_descriptions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listing_descriptions ALTER COLUMN id SET DEFAULT nextval('public.listing_descriptions_id_seq'::regclass);


--
-- Name: listing_document_types id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listing_document_types ALTER COLUMN id SET DEFAULT nextval('public.listing_document_types_id_seq'::regclass);


--
-- Name: listing_images id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listing_images ALTER COLUMN id SET DEFAULT nextval('public.listing_images_id_seq'::regclass);


--
-- Name: listing_lightstone_validation_statuses id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listing_lightstone_validation_statuses ALTER COLUMN id SET DEFAULT nextval('public.listing_lightstone_validation_statuses_id_seq'::regclass);


--
-- Name: listing_lightstone_validations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listing_lightstone_validations ALTER COLUMN id SET DEFAULT nextval('public.listing_lightstone_validations_id_seq'::regclass);


--
-- Name: listing_loom_validation_statuses id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listing_loom_validation_statuses ALTER COLUMN id SET DEFAULT nextval('public.listing_loom_validation_statuses_id_seq'::regclass);


--
-- Name: listing_mandate_infos id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listing_mandate_infos ALTER COLUMN id SET DEFAULT nextval('public.listing_mandate_infos_id_seq'::regclass);


--
-- Name: listing_mandate_types id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listing_mandate_types ALTER COLUMN id SET DEFAULT nextval('public.listing_mandate_types_id_seq'::regclass);


--
-- Name: listing_marketing_url_types id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listing_marketing_url_types ALTER COLUMN id SET DEFAULT nextval('public.listing_marketing_url_types_id_seq'::regclass);


--
-- Name: listing_marketing_urls id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listing_marketing_urls ALTER COLUMN id SET DEFAULT nextval('public.listing_marketing_urls_id_seq'::regclass);


--
-- Name: listing_ownership_types id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listing_ownership_types ALTER COLUMN id SET DEFAULT nextval('public.listing_ownership_types_id_seq'::regclass);


--
-- Name: listing_p24_feed_item_statuses id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listing_p24_feed_item_statuses ALTER COLUMN id SET DEFAULT nextval('public.listing_p24_feed_item_statuses_id_seq'::regclass);


--
-- Name: listing_p24_feed_items id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listing_p24_feed_items ALTER COLUMN id SET DEFAULT nextval('public.listing_p24_feed_items_id_seq'::regclass);


--
-- Name: listing_price_details id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listing_price_details ALTER COLUMN id SET DEFAULT nextval('public.listing_price_details_id_seq'::regclass);


--
-- Name: listing_property_area_types id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listing_property_area_types ALTER COLUMN id SET DEFAULT nextval('public.listing_property_area_types_id_seq'::regclass);


--
-- Name: listing_property_areas id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listing_property_areas ALTER COLUMN id SET DEFAULT nextval('public.listing_property_areas_id_seq'::regclass);


--
-- Name: listing_sale_or_rent_types id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listing_sale_or_rent_types ALTER COLUMN id SET DEFAULT nextval('public.listing_sale_or_rent_types_id_seq'::regclass);


--
-- Name: listing_status_tags id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listing_status_tags ALTER COLUMN id SET DEFAULT nextval('public.listing_status_tags_id_seq'::regclass);


--
-- Name: listing_statuses id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listing_statuses ALTER COLUMN id SET DEFAULT nextval('public.listing_statuses_id_seq'::regclass);


--
-- Name: listing_sub_types id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listing_sub_types ALTER COLUMN id SET DEFAULT nextval('public.listing_sub_types_id_seq'::regclass);


--
-- Name: listing_third_party_integrations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listing_third_party_integrations ALTER COLUMN id SET DEFAULT nextval('public.listing_third_party_integrations_id_seq'::regclass);


--
-- Name: listing_types id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listing_types ALTER COLUMN id SET DEFAULT nextval('public.listing_types_id_seq'::regclass);


--
-- Name: listings id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listings ALTER COLUMN id SET DEFAULT nextval('public.listings_id_seq'::regclass);


--
-- Name: loom_user_tokens id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loom_user_tokens ALTER COLUMN id SET DEFAULT nextval('public.loom_user_tokens_id_seq'::regclass);


--
-- Name: market_center_statuses id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_center_statuses ALTER COLUMN id SET DEFAULT nextval('public.market_center_statuses_id_seq'::regclass);


--
-- Name: market_centers id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_centers ALTER COLUMN id SET DEFAULT nextval('public.market_centers_id_seq'::regclass);


--
-- Name: marketing_plan_documents id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketing_plan_documents ALTER COLUMN id SET DEFAULT nextval('public.marketing_plan_documents_id_seq'::regclass);


--
-- Name: provinces id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.provinces ALTER COLUMN id SET DEFAULT nextval('public.provinces_id_seq'::regclass);


--
-- Name: public_leads id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.public_leads ALTER COLUMN id SET DEFAULT nextval('public.public_leads_id_seq'::regclass);


--
-- Name: referral_statuses id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referral_statuses ALTER COLUMN id SET DEFAULT nextval('public.referral_statuses_id_seq'::regclass);


--
-- Name: referral_types id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referral_types ALTER COLUMN id SET DEFAULT nextval('public.referral_types_id_seq'::regclass);


--
-- Name: suburbs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.suburbs ALTER COLUMN id SET DEFAULT nextval('public.suburbs_id_seq'::regclass);


--
-- Name: team_statuses id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_statuses ALTER COLUMN id SET DEFAULT nextval('public.team_statuses_id_seq'::regclass);


--
-- Name: teams id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teams ALTER COLUMN id SET DEFAULT nextval('public.teams_id_seq'::regclass);


--
-- Name: transaction_associate_payment_details id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transaction_associate_payment_details ALTER COLUMN id SET DEFAULT nextval('public.transaction_associate_payment_details_id_seq'::regclass);


--
-- Name: transaction_associate_types id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transaction_associate_types ALTER COLUMN id SET DEFAULT nextval('public.transaction_associate_types_id_seq'::regclass);


--
-- Name: transaction_associates id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transaction_associates ALTER COLUMN id SET DEFAULT nextval('public.transaction_associates_id_seq'::regclass);


--
-- Name: transaction_bonds id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transaction_bonds ALTER COLUMN id SET DEFAULT nextval('public.transaction_bonds_id_seq'::regclass);


--
-- Name: transaction_contact_types id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transaction_contact_types ALTER COLUMN id SET DEFAULT nextval('public.transaction_contact_types_id_seq'::regclass);


--
-- Name: transaction_contacts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transaction_contacts ALTER COLUMN id SET DEFAULT nextval('public.transaction_contacts_id_seq'::regclass);


--
-- Name: transaction_descriptions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transaction_descriptions ALTER COLUMN id SET DEFAULT nextval('public.transaction_descriptions_id_seq'::regclass);


--
-- Name: transaction_documents id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transaction_documents ALTER COLUMN id SET DEFAULT nextval('public.transaction_documents_id_seq'::regclass);


--
-- Name: transaction_financial_institutions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transaction_financial_institutions ALTER COLUMN id SET DEFAULT nextval('public.transaction_financial_institutions_id_seq'::regclass);


--
-- Name: transaction_financing_channels id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transaction_financing_channels ALTER COLUMN id SET DEFAULT nextval('public.transaction_financing_channels_id_seq'::regclass);


--
-- Name: transaction_financing_types id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transaction_financing_types ALTER COLUMN id SET DEFAULT nextval('public.transaction_financing_types_id_seq'::regclass);


--
-- Name: transaction_notes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transaction_notes ALTER COLUMN id SET DEFAULT nextval('public.transaction_notes_id_seq'::regclass);


--
-- Name: transaction_statuses id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transaction_statuses ALTER COLUMN id SET DEFAULT nextval('public.transaction_statuses_id_seq'::regclass);


--
-- Name: transactions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions ALTER COLUMN id SET DEFAULT nextval('public.transactions_id_seq'::regclass);


--
-- Name: associate_documents_raw id; Type: DEFAULT; Schema: staging; Owner: -
--

ALTER TABLE ONLY staging.associate_documents_raw ALTER COLUMN id SET DEFAULT nextval('staging.associate_documents_raw_id_seq'::regclass);


--
-- Name: associates_raw id; Type: DEFAULT; Schema: staging; Owner: -
--

ALTER TABLE ONLY staging.associates_raw ALTER COLUMN id SET DEFAULT nextval('staging.associates_raw_id_seq'::regclass);


--
-- Name: listing_associates id; Type: DEFAULT; Schema: staging; Owner: -
--

ALTER TABLE ONLY staging.listing_associates ALTER COLUMN id SET DEFAULT nextval('staging.listing_associates_id_seq'::regclass);


--
-- Name: listing_documents_raw id; Type: DEFAULT; Schema: staging; Owner: -
--

ALTER TABLE ONLY staging.listing_documents_raw ALTER COLUMN id SET DEFAULT nextval('staging.listing_documents_raw_id_seq'::regclass);


--
-- Name: listing_features_raw id; Type: DEFAULT; Schema: staging; Owner: -
--

ALTER TABLE ONLY staging.listing_features_raw ALTER COLUMN id SET DEFAULT nextval('staging.listing_features_raw_id_seq'::regclass);


--
-- Name: listing_images_raw id; Type: DEFAULT; Schema: staging; Owner: -
--

ALTER TABLE ONLY staging.listing_images_raw ALTER COLUMN id SET DEFAULT nextval('staging.listing_images_raw_id_seq'::regclass);


--
-- Name: listing_marketing_urls_raw id; Type: DEFAULT; Schema: staging; Owner: -
--

ALTER TABLE ONLY staging.listing_marketing_urls_raw ALTER COLUMN id SET DEFAULT nextval('staging.listing_marketing_urls_raw_id_seq'::regclass);


--
-- Name: listing_p24_feed_items_raw id; Type: DEFAULT; Schema: staging; Owner: -
--

ALTER TABLE ONLY staging.listing_p24_feed_items_raw ALTER COLUMN id SET DEFAULT nextval('staging.listing_p24_feed_items_raw_id_seq'::regclass);


--
-- Name: listing_property_areas_raw id; Type: DEFAULT; Schema: staging; Owner: -
--

ALTER TABLE ONLY staging.listing_property_areas_raw ALTER COLUMN id SET DEFAULT nextval('staging.listing_property_areas_raw_id_seq'::regclass);


--
-- Name: listings_raw id; Type: DEFAULT; Schema: staging; Owner: -
--

ALTER TABLE ONLY staging.listings_raw ALTER COLUMN id SET DEFAULT nextval('staging.listings_raw_id_seq'::regclass);


--
-- Name: market_centers_raw id; Type: DEFAULT; Schema: staging; Owner: -
--

ALTER TABLE ONLY staging.market_centers_raw ALTER COLUMN id SET DEFAULT nextval('staging.market_centers_raw_id_seq'::regclass);


--
-- Name: ssms_listing_area_features_flat_raw id; Type: DEFAULT; Schema: staging; Owner: -
--

ALTER TABLE ONLY staging.ssms_listing_area_features_flat_raw ALTER COLUMN id SET DEFAULT nextval('staging.ssms_listing_area_features_flat_raw_id_seq'::regclass);


--
-- Name: ssms_listing_building_area_features_raw id; Type: DEFAULT; Schema: staging; Owner: -
--

ALTER TABLE ONLY staging.ssms_listing_building_area_features_raw ALTER COLUMN id SET DEFAULT nextval('staging.ssms_listing_building_area_features_raw_id_seq'::regclass);


--
-- Name: ssms_listing_building_info_internet_raw id; Type: DEFAULT; Schema: staging; Owner: -
--

ALTER TABLE ONLY staging.ssms_listing_building_info_internet_raw ALTER COLUMN id SET DEFAULT nextval('staging.ssms_listing_building_info_internet_raw_id_seq'::regclass);


--
-- Name: ssms_listing_building_info_public_transport_raw id; Type: DEFAULT; Schema: staging; Owner: -
--

ALTER TABLE ONLY staging.ssms_listing_building_info_public_transport_raw ALTER COLUMN id SET DEFAULT nextval('staging.ssms_listing_building_info_public_transport_raw_id_seq'::regclass);


--
-- Name: ssms_listing_building_info_raw id; Type: DEFAULT; Schema: staging; Owner: -
--

ALTER TABLE ONLY staging.ssms_listing_building_info_raw ALTER COLUMN id SET DEFAULT nextval('staging.ssms_listing_building_info_raw_id_seq'::regclass);


--
-- Name: ssms_listing_building_info_sustainability_raw id; Type: DEFAULT; Schema: staging; Owner: -
--

ALTER TABLE ONLY staging.ssms_listing_building_info_sustainability_raw ALTER COLUMN id SET DEFAULT nextval('staging.ssms_listing_building_info_sustainability_raw_id_seq'::regclass);


--
-- Name: ssms_listing_details_raw id; Type: DEFAULT; Schema: staging; Owner: -
--

ALTER TABLE ONLY staging.ssms_listing_details_raw ALTER COLUMN id SET DEFAULT nextval('staging.ssms_listing_details_raw_id_seq'::regclass);


--
-- Name: ssms_listing_property_area_features_raw id; Type: DEFAULT; Schema: staging; Owner: -
--

ALTER TABLE ONLY staging.ssms_listing_property_area_features_raw ALTER COLUMN id SET DEFAULT nextval('staging.ssms_listing_property_area_features_raw_id_seq'::regclass);


--
-- Name: ssms_listing_property_areas_raw id; Type: DEFAULT; Schema: staging; Owner: -
--

ALTER TABLE ONLY staging.ssms_listing_property_areas_raw ALTER COLUMN id SET DEFAULT nextval('staging.ssms_listing_property_areas_raw_id_seq'::regclass);


--
-- Name: teams_raw id; Type: DEFAULT; Schema: staging; Owner: -
--

ALTER TABLE ONLY staging.teams_raw ALTER COLUMN id SET DEFAULT nextval('staging.teams_raw_id_seq'::regclass);


--
-- Name: transaction_agents id; Type: DEFAULT; Schema: staging; Owner: -
--

ALTER TABLE ONLY staging.transaction_agents ALTER COLUMN id SET DEFAULT nextval('staging.transaction_agents_id_seq'::regclass);


--
-- Name: transaction_associate_payment_details id; Type: DEFAULT; Schema: staging; Owner: -
--

ALTER TABLE ONLY staging.transaction_associate_payment_details ALTER COLUMN id SET DEFAULT nextval('staging.transaction_associate_payment_details_id_seq'::regclass);


--
-- Name: transaction_bonds id; Type: DEFAULT; Schema: staging; Owner: -
--

ALTER TABLE ONLY staging.transaction_bonds ALTER COLUMN id SET DEFAULT nextval('staging.transaction_bonds_id_seq'::regclass);


--
-- Name: transaction_contacts_raw id; Type: DEFAULT; Schema: staging; Owner: -
--

ALTER TABLE ONLY staging.transaction_contacts_raw ALTER COLUMN id SET DEFAULT nextval('staging.transaction_contacts_raw_id_seq'::regclass);


--
-- Name: transaction_documents_raw id; Type: DEFAULT; Schema: staging; Owner: -
--

ALTER TABLE ONLY staging.transaction_documents_raw ALTER COLUMN id SET DEFAULT nextval('staging.transaction_documents_raw_id_seq'::regclass);


--
-- Name: transaction_notes id; Type: DEFAULT; Schema: staging; Owner: -
--

ALTER TABLE ONLY staging.transaction_notes ALTER COLUMN id SET DEFAULT nextval('staging.transaction_notes_id_seq'::regclass);


--
-- Name: transactions_raw id; Type: DEFAULT; Schema: staging; Owner: -
--

ALTER TABLE ONLY staging.transactions_raw ALTER COLUMN id SET DEFAULT nextval('staging.transactions_raw_id_seq'::regclass);


--
-- Name: rental_audit_log rental_audit_log_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.rental_audit_log
    ADD CONSTRAINT rental_audit_log_pkey PRIMARY KEY (id);


--
-- Name: rental_documents rental_documents_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.rental_documents
    ADD CONSTRAINT rental_documents_pkey PRIMARY KEY (id);


--
-- Name: rental_participants rental_participants_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.rental_participants
    ADD CONSTRAINT rental_participants_pkey PRIMARY KEY (id);


--
-- Name: rental_payment_schedule rental_payment_schedule_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.rental_payment_schedule
    ADD CONSTRAINT rental_payment_schedule_pkey PRIMARY KEY (id);


--
-- Name: rentals rentals_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.rentals
    ADD CONSTRAINT rentals_pkey PRIMARY KEY (id);


--
-- Name: rentals rentals_rental_number_key; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.rentals
    ADD CONSTRAINT rentals_rental_number_key UNIQUE (rental_number);


--
-- Name: agent_deregistration_log agent_deregistration_log_pkey; Type: CONSTRAINT; Schema: migration; Owner: -
--

ALTER TABLE ONLY migration.agent_deregistration_log
    ADD CONSTRAINT agent_deregistration_log_pkey PRIMARY KEY (id);


--
-- Name: agent_reactivation_log agent_reactivation_log_pkey; Type: CONSTRAINT; Schema: migration; Owner: -
--

ALTER TABLE ONLY migration.agent_reactivation_log
    ADD CONSTRAINT agent_reactivation_log_pkey PRIMARY KEY (id);


--
-- Name: associate_admin_market_centers associate_admin_market_centers_pkey; Type: CONSTRAINT; Schema: migration; Owner: -
--

ALTER TABLE ONLY migration.associate_admin_market_centers
    ADD CONSTRAINT associate_admin_market_centers_pkey PRIMARY KEY (id);


--
-- Name: associate_admin_teams associate_admin_teams_pkey; Type: CONSTRAINT; Schema: migration; Owner: -
--

ALTER TABLE ONLY migration.associate_admin_teams
    ADD CONSTRAINT associate_admin_teams_pkey PRIMARY KEY (id);


--
-- Name: associate_documents associate_documents_pkey; Type: CONSTRAINT; Schema: migration; Owner: -
--

ALTER TABLE ONLY migration.associate_documents
    ADD CONSTRAINT associate_documents_pkey PRIMARY KEY (id);


--
-- Name: associate_job_titles associate_job_titles_pkey; Type: CONSTRAINT; Schema: migration; Owner: -
--

ALTER TABLE ONLY migration.associate_job_titles
    ADD CONSTRAINT associate_job_titles_pkey PRIMARY KEY (id);


--
-- Name: associate_notes associate_notes_pkey; Type: CONSTRAINT; Schema: migration; Owner: -
--

ALTER TABLE ONLY migration.associate_notes
    ADD CONSTRAINT associate_notes_pkey PRIMARY KEY (id);


--
-- Name: associate_roles associate_roles_pkey; Type: CONSTRAINT; Schema: migration; Owner: -
--

ALTER TABLE ONLY migration.associate_roles
    ADD CONSTRAINT associate_roles_pkey PRIMARY KEY (id);


--
-- Name: associate_service_communities associate_service_communities_pkey; Type: CONSTRAINT; Schema: migration; Owner: -
--

ALTER TABLE ONLY migration.associate_service_communities
    ADD CONSTRAINT associate_service_communities_pkey PRIMARY KEY (id);


--
-- Name: associate_social_media associate_social_media_pkey; Type: CONSTRAINT; Schema: migration; Owner: -
--

ALTER TABLE ONLY migration.associate_social_media
    ADD CONSTRAINT associate_social_media_pkey PRIMARY KEY (id);


--
-- Name: associates_prepared associates_prepared_pkey; Type: CONSTRAINT; Schema: migration; Owner: -
--

ALTER TABLE ONLY migration.associates_prepared
    ADD CONSTRAINT associates_prepared_pkey PRIMARY KEY (source_associate_id);


--
-- Name: core_associates core_associates_pkey; Type: CONSTRAINT; Schema: migration; Owner: -
--

ALTER TABLE ONLY migration.core_associates
    ADD CONSTRAINT core_associates_pkey PRIMARY KEY (id);


--
-- Name: core_associates core_associates_source_associate_id_key; Type: CONSTRAINT; Schema: migration; Owner: -
--

ALTER TABLE ONLY migration.core_associates
    ADD CONSTRAINT core_associates_source_associate_id_key UNIQUE (source_associate_id);


--
-- Name: core_listings core_listings_pkey; Type: CONSTRAINT; Schema: migration; Owner: -
--

ALTER TABLE ONLY migration.core_listings
    ADD CONSTRAINT core_listings_pkey PRIMARY KEY (id);


--
-- Name: core_listings core_listings_source_listing_id_key; Type: CONSTRAINT; Schema: migration; Owner: -
--

ALTER TABLE ONLY migration.core_listings
    ADD CONSTRAINT core_listings_source_listing_id_key UNIQUE (source_listing_id);


--
-- Name: core_market_centers core_market_centers_pkey; Type: CONSTRAINT; Schema: migration; Owner: -
--

ALTER TABLE ONLY migration.core_market_centers
    ADD CONSTRAINT core_market_centers_pkey PRIMARY KEY (id);


--
-- Name: core_market_centers core_market_centers_source_market_center_id_key; Type: CONSTRAINT; Schema: migration; Owner: -
--

ALTER TABLE ONLY migration.core_market_centers
    ADD CONSTRAINT core_market_centers_source_market_center_id_key UNIQUE (source_market_center_id);


--
-- Name: core_teams core_teams_pkey; Type: CONSTRAINT; Schema: migration; Owner: -
--

ALTER TABLE ONLY migration.core_teams
    ADD CONSTRAINT core_teams_pkey PRIMARY KEY (id);


--
-- Name: core_teams core_teams_source_team_id_key; Type: CONSTRAINT; Schema: migration; Owner: -
--

ALTER TABLE ONLY migration.core_teams
    ADD CONSTRAINT core_teams_source_team_id_key UNIQUE (source_team_id);


--
-- Name: core_transactions core_transactions_pkey; Type: CONSTRAINT; Schema: migration; Owner: -
--

ALTER TABLE ONLY migration.core_transactions
    ADD CONSTRAINT core_transactions_pkey PRIMARY KEY (id);


--
-- Name: core_transactions core_transactions_source_transaction_id_key; Type: CONSTRAINT; Schema: migration; Owner: -
--

ALTER TABLE ONLY migration.core_transactions
    ADD CONSTRAINT core_transactions_source_transaction_id_key UNIQUE (source_transaction_id);


--
-- Name: id_map_associates id_map_associates_pkey; Type: CONSTRAINT; Schema: migration; Owner: -
--

ALTER TABLE ONLY migration.id_map_associates
    ADD CONSTRAINT id_map_associates_pkey PRIMARY KEY (source_associate_id);


--
-- Name: id_map_legacy_associates id_map_legacy_associates_pkey; Type: CONSTRAINT; Schema: migration; Owner: -
--

ALTER TABLE ONLY migration.id_map_legacy_associates
    ADD CONSTRAINT id_map_legacy_associates_pkey PRIMARY KEY (source_associate_id);


--
-- Name: id_map_legacy_listings id_map_legacy_listings_pkey; Type: CONSTRAINT; Schema: migration; Owner: -
--

ALTER TABLE ONLY migration.id_map_legacy_listings
    ADD CONSTRAINT id_map_legacy_listings_pkey PRIMARY KEY (source_listing_id);


--
-- Name: id_map_legacy_market_centers id_map_legacy_market_centers_pkey; Type: CONSTRAINT; Schema: migration; Owner: -
--

ALTER TABLE ONLY migration.id_map_legacy_market_centers
    ADD CONSTRAINT id_map_legacy_market_centers_pkey PRIMARY KEY (source_market_center_id);


--
-- Name: id_map_listings id_map_listings_pkey; Type: CONSTRAINT; Schema: migration; Owner: -
--

ALTER TABLE ONLY migration.id_map_listings
    ADD CONSTRAINT id_map_listings_pkey PRIMARY KEY (source_listing_id);


--
-- Name: id_map_market_centers id_map_market_centers_pkey; Type: CONSTRAINT; Schema: migration; Owner: -
--

ALTER TABLE ONLY migration.id_map_market_centers
    ADD CONSTRAINT id_map_market_centers_pkey PRIMARY KEY (source_market_center_id);


--
-- Name: id_map_teams id_map_teams_pkey; Type: CONSTRAINT; Schema: migration; Owner: -
--

ALTER TABLE ONLY migration.id_map_teams
    ADD CONSTRAINT id_map_teams_pkey PRIMARY KEY (source_team_id);


--
-- Name: in_app_notifications in_app_notifications_pkey; Type: CONSTRAINT; Schema: migration; Owner: -
--

ALTER TABLE ONLY migration.in_app_notifications
    ADD CONSTRAINT in_app_notifications_pkey PRIMARY KEY (id);


--
-- Name: listing_agents listing_agents_pkey; Type: CONSTRAINT; Schema: migration; Owner: -
--

ALTER TABLE ONLY migration.listing_agents
    ADD CONSTRAINT listing_agents_pkey PRIMARY KEY (id);


--
-- Name: listing_approval_requests listing_approval_requests_listing_id_key; Type: CONSTRAINT; Schema: migration; Owner: -
--

ALTER TABLE ONLY migration.listing_approval_requests
    ADD CONSTRAINT listing_approval_requests_listing_id_key UNIQUE (listing_id);


--
-- Name: listing_approval_requests listing_approval_requests_pkey; Type: CONSTRAINT; Schema: migration; Owner: -
--

ALTER TABLE ONLY migration.listing_approval_requests
    ADD CONSTRAINT listing_approval_requests_pkey PRIMARY KEY (id);


--
-- Name: listing_contacts listing_contacts_pkey; Type: CONSTRAINT; Schema: migration; Owner: -
--

ALTER TABLE ONLY migration.listing_contacts
    ADD CONSTRAINT listing_contacts_pkey PRIMARY KEY (id);


--
-- Name: listing_features listing_features_pkey; Type: CONSTRAINT; Schema: migration; Owner: -
--

ALTER TABLE ONLY migration.listing_features
    ADD CONSTRAINT listing_features_pkey PRIMARY KEY (id);


--
-- Name: listing_images listing_images_pkey; Type: CONSTRAINT; Schema: migration; Owner: -
--

ALTER TABLE ONLY migration.listing_images
    ADD CONSTRAINT listing_images_pkey PRIMARY KEY (id);


--
-- Name: listing_mandate_documents listing_mandate_documents_pkey; Type: CONSTRAINT; Schema: migration; Owner: -
--

ALTER TABLE ONLY migration.listing_mandate_documents
    ADD CONSTRAINT listing_mandate_documents_pkey PRIMARY KEY (id);


--
-- Name: listing_marketing_urls listing_marketing_urls_pkey; Type: CONSTRAINT; Schema: migration; Owner: -
--

ALTER TABLE ONLY migration.listing_marketing_urls
    ADD CONSTRAINT listing_marketing_urls_pkey PRIMARY KEY (id);


--
-- Name: listing_open_house listing_open_house_pkey; Type: CONSTRAINT; Schema: migration; Owner: -
--

ALTER TABLE ONLY migration.listing_open_house
    ADD CONSTRAINT listing_open_house_pkey PRIMARY KEY (id);


--
-- Name: listing_property_areas listing_property_areas_pkey; Type: CONSTRAINT; Schema: migration; Owner: -
--

ALTER TABLE ONLY migration.listing_property_areas
    ADD CONSTRAINT listing_property_areas_pkey PRIMARY KEY (id);


--
-- Name: listing_show_times listing_show_times_pkey; Type: CONSTRAINT; Schema: migration; Owner: -
--

ALTER TABLE ONLY migration.listing_show_times
    ADD CONSTRAINT listing_show_times_pkey PRIMARY KEY (id);


--
-- Name: listing_transfer_log listing_transfer_log_pkey; Type: CONSTRAINT; Schema: migration; Owner: -
--

ALTER TABLE ONLY migration.listing_transfer_log
    ADD CONSTRAINT listing_transfer_log_pkey PRIMARY KEY (id);


--
-- Name: listings_prepared listings_prepared_pkey; Type: CONSTRAINT; Schema: migration; Owner: -
--

ALTER TABLE ONLY migration.listings_prepared
    ADD CONSTRAINT listings_prepared_pkey PRIMARY KEY (source_listing_id);


--
-- Name: load_rejections load_rejections_pkey; Type: CONSTRAINT; Schema: migration; Owner: -
--

ALTER TABLE ONLY migration.load_rejections
    ADD CONSTRAINT load_rejections_pkey PRIMARY KEY (id);


--
-- Name: market_center_notes market_center_notes_pkey; Type: CONSTRAINT; Schema: migration; Owner: -
--

ALTER TABLE ONLY migration.market_center_notes
    ADD CONSTRAINT market_center_notes_pkey PRIMARY KEY (id);


--
-- Name: market_centers_prepared market_centers_prepared_pkey; Type: CONSTRAINT; Schema: migration; Owner: -
--

ALTER TABLE ONLY migration.market_centers_prepared
    ADD CONSTRAINT market_centers_prepared_pkey PRIMARY KEY (source_market_center_id);


--
-- Name: mc_dashboard_daily_snapshots mc_dashboard_daily_snapshots_pkey; Type: CONSTRAINT; Schema: migration; Owner: -
--

ALTER TABLE ONLY migration.mc_dashboard_daily_snapshots
    ADD CONSTRAINT mc_dashboard_daily_snapshots_pkey PRIMARY KEY (snapshot_date, mc_source_id);


--
-- Name: mc_document_hub mc_document_hub_pkey; Type: CONSTRAINT; Schema: migration; Owner: -
--

ALTER TABLE ONLY migration.mc_document_hub
    ADD CONSTRAINT mc_document_hub_pkey PRIMARY KEY (id);


--
-- Name: outside_agency_contacts outside_agency_contacts_pkey; Type: CONSTRAINT; Schema: migration; Owner: -
--

ALTER TABLE ONLY migration.outside_agency_contacts
    ADD CONSTRAINT outside_agency_contacts_pkey PRIMARY KEY (id);


--
-- Name: team_associate_commissions team_associate_commissions_pkey; Type: CONSTRAINT; Schema: migration; Owner: -
--

ALTER TABLE ONLY migration.team_associate_commissions
    ADD CONSTRAINT team_associate_commissions_pkey PRIMARY KEY (id);


--
-- Name: team_associate_commissions team_associate_commissions_team_id_key; Type: CONSTRAINT; Schema: migration; Owner: -
--

ALTER TABLE ONLY migration.team_associate_commissions
    ADD CONSTRAINT team_associate_commissions_team_id_key UNIQUE (team_id);


--
-- Name: team_cap_history team_cap_history_pkey; Type: CONSTRAINT; Schema: migration; Owner: -
--

ALTER TABLE ONLY migration.team_cap_history
    ADD CONSTRAINT team_cap_history_pkey PRIMARY KEY (id);


--
-- Name: team_caps team_caps_pkey; Type: CONSTRAINT; Schema: migration; Owner: -
--

ALTER TABLE ONLY migration.team_caps
    ADD CONSTRAINT team_caps_pkey PRIMARY KEY (id);


--
-- Name: team_caps team_caps_team_id_cap_year_key; Type: CONSTRAINT; Schema: migration; Owner: -
--

ALTER TABLE ONLY migration.team_caps
    ADD CONSTRAINT team_caps_team_id_cap_year_key UNIQUE (team_id, cap_year);


--
-- Name: team_dates team_dates_pkey; Type: CONSTRAINT; Schema: migration; Owner: -
--

ALTER TABLE ONLY migration.team_dates
    ADD CONSTRAINT team_dates_pkey PRIMARY KEY (id);


--
-- Name: team_dates team_dates_team_id_key; Type: CONSTRAINT; Schema: migration; Owner: -
--

ALTER TABLE ONLY migration.team_dates
    ADD CONSTRAINT team_dates_team_id_key UNIQUE (team_id);


--
-- Name: team_notes team_notes_pkey; Type: CONSTRAINT; Schema: migration; Owner: -
--

ALTER TABLE ONLY migration.team_notes
    ADD CONSTRAINT team_notes_pkey PRIMARY KEY (id);


--
-- Name: team_portal_settings team_portal_settings_pkey; Type: CONSTRAINT; Schema: migration; Owner: -
--

ALTER TABLE ONLY migration.team_portal_settings
    ADD CONSTRAINT team_portal_settings_pkey PRIMARY KEY (id);


--
-- Name: team_portal_settings team_portal_settings_team_id_key; Type: CONSTRAINT; Schema: migration; Owner: -
--

ALTER TABLE ONLY migration.team_portal_settings
    ADD CONSTRAINT team_portal_settings_team_id_key UNIQUE (team_id);


--
-- Name: teams_prepared teams_prepared_pkey; Type: CONSTRAINT; Schema: migration; Owner: -
--

ALTER TABLE ONLY migration.teams_prepared
    ADD CONSTRAINT teams_prepared_pkey PRIMARY KEY (source_team_id);


--
-- Name: transaction_agent_calculations transaction_agent_calculations_pkey; Type: CONSTRAINT; Schema: migration; Owner: -
--

ALTER TABLE ONLY migration.transaction_agent_calculations
    ADD CONSTRAINT transaction_agent_calculations_pkey PRIMARY KEY (id);


--
-- Name: transaction_agents transaction_agents_pkey; Type: CONSTRAINT; Schema: migration; Owner: -
--

ALTER TABLE ONLY migration.transaction_agents
    ADD CONSTRAINT transaction_agents_pkey PRIMARY KEY (id);


--
-- Name: transaction_documents transaction_documents_pkey; Type: CONSTRAINT; Schema: migration; Owner: -
--

ALTER TABLE ONLY migration.transaction_documents
    ADD CONSTRAINT transaction_documents_pkey PRIMARY KEY (id);


--
-- Name: transaction_status_history transaction_status_history_pkey; Type: CONSTRAINT; Schema: migration; Owner: -
--

ALTER TABLE ONLY migration.transaction_status_history
    ADD CONSTRAINT transaction_status_history_pkey PRIMARY KEY (id);


--
-- Name: transactions_prepared transactions_prepared_pkey; Type: CONSTRAINT; Schema: migration; Owner: -
--

ALTER TABLE ONLY migration.transactions_prepared
    ADD CONSTRAINT transactions_prepared_pkey PRIMARY KEY (source_transaction_id, source_associate_id);


--
-- Name: SoftDeleteHelper SoftDeleteHelper_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SoftDeleteHelper"
    ADD CONSTRAINT "SoftDeleteHelper_pkey" PRIMARY KEY (id);


--
-- Name: addresses addresses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.addresses
    ADD CONSTRAINT addresses_pkey PRIMARY KEY (id);


--
-- Name: app_users app_users_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_users
    ADD CONSTRAINT app_users_email_key UNIQUE (email);


--
-- Name: app_users app_users_google_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_users
    ADD CONSTRAINT app_users_google_id_key UNIQUE (google_id);


--
-- Name: app_users app_users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_users
    ADD CONSTRAINT app_users_pkey PRIMARY KEY (id);


--
-- Name: associate_business_details associate_business_details_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.associate_business_details
    ADD CONSTRAINT associate_business_details_pkey PRIMARY KEY (id);


--
-- Name: associate_contact_details associate_contact_details_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.associate_contact_details
    ADD CONSTRAINT associate_contact_details_pkey PRIMARY KEY (id);


--
-- Name: associate_statuses associate_statuses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.associate_statuses
    ADD CONSTRAINT associate_statuses_pkey PRIMARY KEY (id);


--
-- Name: associate_third_party_integrations associate_third_party_integrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.associate_third_party_integrations
    ADD CONSTRAINT associate_third_party_integrations_pkey PRIMARY KEY (id);


--
-- Name: associate_transfer_statuses associate_transfer_statuses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.associate_transfer_statuses
    ADD CONSTRAINT associate_transfer_statuses_pkey PRIMARY KEY (id);


--
-- Name: associate_transfers associate_transfers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.associate_transfers
    ADD CONSTRAINT associate_transfers_pkey PRIMARY KEY (id);


--
-- Name: associates associates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.associates
    ADD CONSTRAINT associates_pkey PRIMARY KEY (id);


--
-- Name: audit_logs audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);


--
-- Name: cities cities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cities
    ADD CONSTRAINT cities_pkey PRIMARY KEY (id);


--
-- Name: cma_documents cma_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cma_documents
    ADD CONSTRAINT cma_documents_pkey PRIMARY KEY (id);


--
-- Name: contacts contacts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contacts
    ADD CONSTRAINT contacts_pkey PRIMARY KEY (id);


--
-- Name: countries countries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.countries
    ADD CONSTRAINT countries_pkey PRIMARY KEY (id);


--
-- Name: documents documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_pkey PRIMARY KEY (id);


--
-- Name: email_types email_types_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_types
    ADD CONSTRAINT email_types_pkey PRIMARY KEY (id);


--
-- Name: icon_types icon_types_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.icon_types
    ADD CONSTRAINT icon_types_pkey PRIMARY KEY (id);


--
-- Name: listing_associate_types listing_associate_types_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listing_associate_types
    ADD CONSTRAINT listing_associate_types_pkey PRIMARY KEY (id);


--
-- Name: listing_associates listing_associates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listing_associates
    ADD CONSTRAINT listing_associates_pkey PRIMARY KEY (id);


--
-- Name: listing_building_area_feature_types listing_building_area_feature_types_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listing_building_area_feature_types
    ADD CONSTRAINT listing_building_area_feature_types_pkey PRIMARY KEY (id);


--
-- Name: listing_building_area_features listing_building_area_features_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listing_building_area_features
    ADD CONSTRAINT listing_building_area_features_pkey PRIMARY KEY (id);


--
-- Name: listing_building_infos listing_building_infos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listing_building_infos
    ADD CONSTRAINT listing_building_infos_pkey PRIMARY KEY (id);


--
-- Name: listing_building_zoning_types listing_building_zoning_types_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listing_building_zoning_types
    ADD CONSTRAINT listing_building_zoning_types_pkey PRIMARY KEY (id);


--
-- Name: listing_descriptions listing_descriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listing_descriptions
    ADD CONSTRAINT listing_descriptions_pkey PRIMARY KEY (id);


--
-- Name: listing_document_types listing_document_types_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listing_document_types
    ADD CONSTRAINT listing_document_types_pkey PRIMARY KEY (id);


--
-- Name: listing_images listing_images_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listing_images
    ADD CONSTRAINT listing_images_pkey PRIMARY KEY (id);


--
-- Name: listing_lightstone_validation_statuses listing_lightstone_validation_statuses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listing_lightstone_validation_statuses
    ADD CONSTRAINT listing_lightstone_validation_statuses_pkey PRIMARY KEY (id);


--
-- Name: listing_lightstone_validations listing_lightstone_validations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listing_lightstone_validations
    ADD CONSTRAINT listing_lightstone_validations_pkey PRIMARY KEY (id);


--
-- Name: listing_loom_validation_statuses listing_loom_validation_statuses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listing_loom_validation_statuses
    ADD CONSTRAINT listing_loom_validation_statuses_pkey PRIMARY KEY (id);


--
-- Name: listing_mandate_infos listing_mandate_infos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listing_mandate_infos
    ADD CONSTRAINT listing_mandate_infos_pkey PRIMARY KEY (id);


--
-- Name: listing_mandate_types listing_mandate_types_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listing_mandate_types
    ADD CONSTRAINT listing_mandate_types_pkey PRIMARY KEY (id);


--
-- Name: listing_marketing_url_types listing_marketing_url_types_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listing_marketing_url_types
    ADD CONSTRAINT listing_marketing_url_types_pkey PRIMARY KEY (id);


--
-- Name: listing_marketing_urls listing_marketing_urls_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listing_marketing_urls
    ADD CONSTRAINT listing_marketing_urls_pkey PRIMARY KEY (id);


--
-- Name: listing_ownership_types listing_ownership_types_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listing_ownership_types
    ADD CONSTRAINT listing_ownership_types_pkey PRIMARY KEY (id);


--
-- Name: listing_p24_feed_item_statuses listing_p24_feed_item_statuses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listing_p24_feed_item_statuses
    ADD CONSTRAINT listing_p24_feed_item_statuses_pkey PRIMARY KEY (id);


--
-- Name: listing_p24_feed_items listing_p24_feed_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listing_p24_feed_items
    ADD CONSTRAINT listing_p24_feed_items_pkey PRIMARY KEY (id);


--
-- Name: listing_price_details listing_price_details_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listing_price_details
    ADD CONSTRAINT listing_price_details_pkey PRIMARY KEY (id);


--
-- Name: listing_property_area_types listing_property_area_types_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listing_property_area_types
    ADD CONSTRAINT listing_property_area_types_pkey PRIMARY KEY (id);


--
-- Name: listing_property_areas listing_property_areas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listing_property_areas
    ADD CONSTRAINT listing_property_areas_pkey PRIMARY KEY (id);


--
-- Name: listing_property_feature_listing_sub_types listing_property_feature_listing_sub_types_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listing_property_feature_listing_sub_types
    ADD CONSTRAINT listing_property_feature_listing_sub_types_pkey PRIMARY KEY ("listingPropertyFeaturesId", "listingSubTypesId");


--
-- Name: listing_property_feature_listing_types listing_property_feature_listing_types_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listing_property_feature_listing_types
    ADD CONSTRAINT listing_property_feature_listing_types_pkey PRIMARY KEY ("listingPropertyFeaturesId", "listingTypesId");


--
-- Name: listing_sale_or_rent_types listing_sale_or_rent_types_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listing_sale_or_rent_types
    ADD CONSTRAINT listing_sale_or_rent_types_pkey PRIMARY KEY (id);


--
-- Name: listing_status_tags listing_status_tags_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listing_status_tags
    ADD CONSTRAINT listing_status_tags_pkey PRIMARY KEY (id);


--
-- Name: listing_statuses listing_statuses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listing_statuses
    ADD CONSTRAINT listing_statuses_pkey PRIMARY KEY (id);


--
-- Name: listing_sub_types listing_sub_types_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listing_sub_types
    ADD CONSTRAINT listing_sub_types_pkey PRIMARY KEY (id);


--
-- Name: listing_third_party_integrations listing_third_party_integrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listing_third_party_integrations
    ADD CONSTRAINT listing_third_party_integrations_pkey PRIMARY KEY (id);


--
-- Name: listing_types listing_types_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listing_types
    ADD CONSTRAINT listing_types_pkey PRIMARY KEY (id);


--
-- Name: listings listings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listings
    ADD CONSTRAINT listings_pkey PRIMARY KEY (id);


--
-- Name: loom_user_tokens loom_user_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loom_user_tokens
    ADD CONSTRAINT loom_user_tokens_pkey PRIMARY KEY (id);


--
-- Name: loom_user_tokens loom_user_tokens_user_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loom_user_tokens
    ADD CONSTRAINT loom_user_tokens_user_email_key UNIQUE (user_email);


--
-- Name: market_center_statuses market_center_statuses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_center_statuses
    ADD CONSTRAINT market_center_statuses_pkey PRIMARY KEY (id);


--
-- Name: market_centers market_centers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_centers
    ADD CONSTRAINT market_centers_pkey PRIMARY KEY (id);


--
-- Name: marketing_plan_documents marketing_plan_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketing_plan_documents
    ADD CONSTRAINT marketing_plan_documents_pkey PRIMARY KEY (id);


--
-- Name: provinces provinces_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.provinces
    ADD CONSTRAINT provinces_pkey PRIMARY KEY (id);


--
-- Name: public_leads public_leads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.public_leads
    ADD CONSTRAINT public_leads_pkey PRIMARY KEY (id);


--
-- Name: referral_statuses referral_statuses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referral_statuses
    ADD CONSTRAINT referral_statuses_pkey PRIMARY KEY (id);


--
-- Name: referral_types referral_types_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referral_types
    ADD CONSTRAINT referral_types_pkey PRIMARY KEY (id);


--
-- Name: roles roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_pkey PRIMARY KEY (id);


--
-- Name: suburbs suburbs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.suburbs
    ADD CONSTRAINT suburbs_pkey PRIMARY KEY (id);


--
-- Name: team_statuses team_statuses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_statuses
    ADD CONSTRAINT team_statuses_pkey PRIMARY KEY (id);


--
-- Name: teams teams_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teams
    ADD CONSTRAINT teams_pkey PRIMARY KEY (id);


--
-- Name: transaction_associate_payment_details transaction_associate_payment_details_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transaction_associate_payment_details
    ADD CONSTRAINT transaction_associate_payment_details_pkey PRIMARY KEY (id);


--
-- Name: transaction_associate_types transaction_associate_types_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transaction_associate_types
    ADD CONSTRAINT transaction_associate_types_pkey PRIMARY KEY (id);


--
-- Name: transaction_associates transaction_associates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transaction_associates
    ADD CONSTRAINT transaction_associates_pkey PRIMARY KEY (id);


--
-- Name: transaction_bonds transaction_bonds_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transaction_bonds
    ADD CONSTRAINT transaction_bonds_pkey PRIMARY KEY (id);


--
-- Name: transaction_contact_types transaction_contact_types_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transaction_contact_types
    ADD CONSTRAINT transaction_contact_types_pkey PRIMARY KEY (id);


--
-- Name: transaction_contacts transaction_contacts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transaction_contacts
    ADD CONSTRAINT transaction_contacts_pkey PRIMARY KEY (id);


--
-- Name: transaction_descriptions transaction_descriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transaction_descriptions
    ADD CONSTRAINT transaction_descriptions_pkey PRIMARY KEY (id);


--
-- Name: transaction_documents transaction_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transaction_documents
    ADD CONSTRAINT transaction_documents_pkey PRIMARY KEY (id);


--
-- Name: transaction_financial_institutions transaction_financial_institutions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transaction_financial_institutions
    ADD CONSTRAINT transaction_financial_institutions_pkey PRIMARY KEY (id);


--
-- Name: transaction_financing_channels transaction_financing_channels_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transaction_financing_channels
    ADD CONSTRAINT transaction_financing_channels_pkey PRIMARY KEY (id);


--
-- Name: transaction_financing_types transaction_financing_types_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transaction_financing_types
    ADD CONSTRAINT transaction_financing_types_pkey PRIMARY KEY (id);


--
-- Name: transaction_notes transaction_notes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transaction_notes
    ADD CONSTRAINT transaction_notes_pkey PRIMARY KEY (id);


--
-- Name: transaction_statuses transaction_statuses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transaction_statuses
    ADD CONSTRAINT transaction_statuses_pkey PRIMARY KEY (id);


--
-- Name: transactions transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_pkey PRIMARY KEY (id);


--
-- Name: user_roles user_roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_pkey PRIMARY KEY ("userId", "roleId");


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: associate_documents_raw associate_documents_raw_pkey; Type: CONSTRAINT; Schema: staging; Owner: -
--

ALTER TABLE ONLY staging.associate_documents_raw
    ADD CONSTRAINT associate_documents_raw_pkey PRIMARY KEY (id);


--
-- Name: associates_raw associates_raw_pkey; Type: CONSTRAINT; Schema: staging; Owner: -
--

ALTER TABLE ONLY staging.associates_raw
    ADD CONSTRAINT associates_raw_pkey PRIMARY KEY (id);


--
-- Name: listing_associates listing_associates_pkey; Type: CONSTRAINT; Schema: staging; Owner: -
--

ALTER TABLE ONLY staging.listing_associates
    ADD CONSTRAINT listing_associates_pkey PRIMARY KEY (id);


--
-- Name: listing_documents_raw listing_documents_raw_pkey; Type: CONSTRAINT; Schema: staging; Owner: -
--

ALTER TABLE ONLY staging.listing_documents_raw
    ADD CONSTRAINT listing_documents_raw_pkey PRIMARY KEY (id);


--
-- Name: listing_features_raw listing_features_raw_pkey; Type: CONSTRAINT; Schema: staging; Owner: -
--

ALTER TABLE ONLY staging.listing_features_raw
    ADD CONSTRAINT listing_features_raw_pkey PRIMARY KEY (id);


--
-- Name: listing_images_raw listing_images_raw_pkey; Type: CONSTRAINT; Schema: staging; Owner: -
--

ALTER TABLE ONLY staging.listing_images_raw
    ADD CONSTRAINT listing_images_raw_pkey PRIMARY KEY (id);


--
-- Name: listing_marketing_urls_raw listing_marketing_urls_raw_pkey; Type: CONSTRAINT; Schema: staging; Owner: -
--

ALTER TABLE ONLY staging.listing_marketing_urls_raw
    ADD CONSTRAINT listing_marketing_urls_raw_pkey PRIMARY KEY (id);


--
-- Name: listing_p24_feed_items_raw listing_p24_feed_items_raw_pkey; Type: CONSTRAINT; Schema: staging; Owner: -
--

ALTER TABLE ONLY staging.listing_p24_feed_items_raw
    ADD CONSTRAINT listing_p24_feed_items_raw_pkey PRIMARY KEY (id);


--
-- Name: listing_property_areas_raw listing_property_areas_raw_pkey; Type: CONSTRAINT; Schema: staging; Owner: -
--

ALTER TABLE ONLY staging.listing_property_areas_raw
    ADD CONSTRAINT listing_property_areas_raw_pkey PRIMARY KEY (id);


--
-- Name: listings_raw listings_raw_pkey; Type: CONSTRAINT; Schema: staging; Owner: -
--

ALTER TABLE ONLY staging.listings_raw
    ADD CONSTRAINT listings_raw_pkey PRIMARY KEY (id);


--
-- Name: market_centers_raw market_centers_raw_pkey; Type: CONSTRAINT; Schema: staging; Owner: -
--

ALTER TABLE ONLY staging.market_centers_raw
    ADD CONSTRAINT market_centers_raw_pkey PRIMARY KEY (id);


--
-- Name: ssms_listing_area_features_flat_raw ssms_listing_area_features_flat_raw_pkey; Type: CONSTRAINT; Schema: staging; Owner: -
--

ALTER TABLE ONLY staging.ssms_listing_area_features_flat_raw
    ADD CONSTRAINT ssms_listing_area_features_flat_raw_pkey PRIMARY KEY (id);


--
-- Name: ssms_listing_building_area_features_raw ssms_listing_building_area_features_raw_pkey; Type: CONSTRAINT; Schema: staging; Owner: -
--

ALTER TABLE ONLY staging.ssms_listing_building_area_features_raw
    ADD CONSTRAINT ssms_listing_building_area_features_raw_pkey PRIMARY KEY (id);


--
-- Name: ssms_listing_building_info_internet_raw ssms_listing_building_info_internet_raw_pkey; Type: CONSTRAINT; Schema: staging; Owner: -
--

ALTER TABLE ONLY staging.ssms_listing_building_info_internet_raw
    ADD CONSTRAINT ssms_listing_building_info_internet_raw_pkey PRIMARY KEY (id);


--
-- Name: ssms_listing_building_info_public_transport_raw ssms_listing_building_info_public_transport_raw_pkey; Type: CONSTRAINT; Schema: staging; Owner: -
--

ALTER TABLE ONLY staging.ssms_listing_building_info_public_transport_raw
    ADD CONSTRAINT ssms_listing_building_info_public_transport_raw_pkey PRIMARY KEY (id);


--
-- Name: ssms_listing_building_info_raw ssms_listing_building_info_raw_pkey; Type: CONSTRAINT; Schema: staging; Owner: -
--

ALTER TABLE ONLY staging.ssms_listing_building_info_raw
    ADD CONSTRAINT ssms_listing_building_info_raw_pkey PRIMARY KEY (id);


--
-- Name: ssms_listing_building_info_sustainability_raw ssms_listing_building_info_sustainability_raw_pkey; Type: CONSTRAINT; Schema: staging; Owner: -
--

ALTER TABLE ONLY staging.ssms_listing_building_info_sustainability_raw
    ADD CONSTRAINT ssms_listing_building_info_sustainability_raw_pkey PRIMARY KEY (id);


--
-- Name: ssms_listing_details_raw ssms_listing_details_raw_pkey; Type: CONSTRAINT; Schema: staging; Owner: -
--

ALTER TABLE ONLY staging.ssms_listing_details_raw
    ADD CONSTRAINT ssms_listing_details_raw_pkey PRIMARY KEY (id);


--
-- Name: ssms_listing_property_area_features_raw ssms_listing_property_area_features_raw_pkey; Type: CONSTRAINT; Schema: staging; Owner: -
--

ALTER TABLE ONLY staging.ssms_listing_property_area_features_raw
    ADD CONSTRAINT ssms_listing_property_area_features_raw_pkey PRIMARY KEY (id);


--
-- Name: ssms_listing_property_areas_raw ssms_listing_property_areas_raw_pkey; Type: CONSTRAINT; Schema: staging; Owner: -
--

ALTER TABLE ONLY staging.ssms_listing_property_areas_raw
    ADD CONSTRAINT ssms_listing_property_areas_raw_pkey PRIMARY KEY (id);


--
-- Name: teams_raw teams_raw_pkey; Type: CONSTRAINT; Schema: staging; Owner: -
--

ALTER TABLE ONLY staging.teams_raw
    ADD CONSTRAINT teams_raw_pkey PRIMARY KEY (id);


--
-- Name: transaction_agents transaction_agents_pkey; Type: CONSTRAINT; Schema: staging; Owner: -
--

ALTER TABLE ONLY staging.transaction_agents
    ADD CONSTRAINT transaction_agents_pkey PRIMARY KEY (id);


--
-- Name: transaction_associate_payment_details transaction_associate_payment_details_pkey; Type: CONSTRAINT; Schema: staging; Owner: -
--

ALTER TABLE ONLY staging.transaction_associate_payment_details
    ADD CONSTRAINT transaction_associate_payment_details_pkey PRIMARY KEY (id);


--
-- Name: transaction_bonds transaction_bonds_pkey; Type: CONSTRAINT; Schema: staging; Owner: -
--

ALTER TABLE ONLY staging.transaction_bonds
    ADD CONSTRAINT transaction_bonds_pkey PRIMARY KEY (id);


--
-- Name: transaction_contacts_raw transaction_contacts_raw_pkey; Type: CONSTRAINT; Schema: staging; Owner: -
--

ALTER TABLE ONLY staging.transaction_contacts_raw
    ADD CONSTRAINT transaction_contacts_raw_pkey PRIMARY KEY (id);


--
-- Name: transaction_documents_raw transaction_documents_raw_pkey; Type: CONSTRAINT; Schema: staging; Owner: -
--

ALTER TABLE ONLY staging.transaction_documents_raw
    ADD CONSTRAINT transaction_documents_raw_pkey PRIMARY KEY (id);


--
-- Name: transaction_notes transaction_notes_pkey; Type: CONSTRAINT; Schema: staging; Owner: -
--

ALTER TABLE ONLY staging.transaction_notes
    ADD CONSTRAINT transaction_notes_pkey PRIMARY KEY (id);


--
-- Name: transactions_raw transactions_raw_pkey; Type: CONSTRAINT; Schema: staging; Owner: -
--

ALTER TABLE ONLY staging.transactions_raw
    ADD CONSTRAINT transactions_raw_pkey PRIMARY KEY (id);


--
-- Name: listings_raw uq_listings_raw_batch_source; Type: CONSTRAINT; Schema: staging; Owner: -
--

ALTER TABLE ONLY staging.listings_raw
    ADD CONSTRAINT uq_listings_raw_batch_source UNIQUE (batch_id, source_listing_id);


--
-- Name: idx_rental_audit_changed_at; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX idx_rental_audit_changed_at ON app.rental_audit_log USING btree (changed_at DESC);


--
-- Name: idx_rental_audit_rental; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX idx_rental_audit_rental ON app.rental_audit_log USING btree (rental_id);


--
-- Name: idx_rental_documents_rental; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX idx_rental_documents_rental ON app.rental_documents USING btree (rental_id);


--
-- Name: idx_rental_participants_associate; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX idx_rental_participants_associate ON app.rental_participants USING btree (associate_id);


--
-- Name: idx_rental_participants_rental; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX idx_rental_participants_rental ON app.rental_participants USING btree (rental_id);


--
-- Name: idx_rental_schedule_due_date; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX idx_rental_schedule_due_date ON app.rental_payment_schedule USING btree (due_date);


--
-- Name: idx_rental_schedule_rental; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX idx_rental_schedule_rental ON app.rental_payment_schedule USING btree (rental_id);


--
-- Name: idx_rental_schedule_status; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX idx_rental_schedule_status ON app.rental_payment_schedule USING btree (payment_status);


--
-- Name: idx_rentals_created_at; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX idx_rentals_created_at ON app.rentals USING btree (created_at DESC);


--
-- Name: idx_rentals_listing_number; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX idx_rentals_listing_number ON app.rentals USING btree (listing_number);


--
-- Name: idx_rentals_market_centre; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX idx_rentals_market_centre ON app.rentals USING btree (market_centre_id);


--
-- Name: idx_rentals_source_listing_id; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX idx_rentals_source_listing_id ON app.rentals USING btree (source_listing_id);


--
-- Name: idx_rentals_status; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX idx_rentals_status ON app.rentals USING btree (rental_status);


--
-- Name: idx_rentals_type; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX idx_rentals_type ON app.rentals USING btree (rental_type);


--
-- Name: idx_assoc_admin_mc; Type: INDEX; Schema: migration; Owner: -
--

CREATE INDEX idx_assoc_admin_mc ON migration.associate_admin_market_centers USING btree (associate_id);


--
-- Name: idx_assoc_admin_teams; Type: INDEX; Schema: migration; Owner: -
--

CREATE INDEX idx_assoc_admin_teams ON migration.associate_admin_teams USING btree (associate_id);


--
-- Name: idx_assoc_documents; Type: INDEX; Schema: migration; Owner: -
--

CREATE INDEX idx_assoc_documents ON migration.associate_documents USING btree (associate_id);


--
-- Name: idx_assoc_job_titles; Type: INDEX; Schema: migration; Owner: -
--

CREATE INDEX idx_assoc_job_titles ON migration.associate_job_titles USING btree (associate_id);


--
-- Name: idx_assoc_notes; Type: INDEX; Schema: migration; Owner: -
--

CREATE INDEX idx_assoc_notes ON migration.associate_notes USING btree (associate_id);


--
-- Name: idx_assoc_roles; Type: INDEX; Schema: migration; Owner: -
--

CREATE INDEX idx_assoc_roles ON migration.associate_roles USING btree (associate_id);


--
-- Name: idx_assoc_service_comm; Type: INDEX; Schema: migration; Owner: -
--

CREATE INDEX idx_assoc_service_comm ON migration.associate_service_communities USING btree (associate_id);


--
-- Name: idx_assoc_social_media; Type: INDEX; Schema: migration; Owner: -
--

CREATE INDEX idx_assoc_social_media ON migration.associate_social_media USING btree (associate_id);


--
-- Name: idx_associate_admin_market_centers_associate; Type: INDEX; Schema: migration; Owner: -
--

CREATE INDEX idx_associate_admin_market_centers_associate ON migration.associate_admin_market_centers USING btree (associate_id);


--
-- Name: idx_associate_admin_teams_associate; Type: INDEX; Schema: migration; Owner: -
--

CREATE INDEX idx_associate_admin_teams_associate ON migration.associate_admin_teams USING btree (associate_id);


--
-- Name: idx_associate_documents_associate; Type: INDEX; Schema: migration; Owner: -
--

CREATE INDEX idx_associate_documents_associate ON migration.associate_documents USING btree (associate_id);


--
-- Name: idx_associate_job_titles_associate; Type: INDEX; Schema: migration; Owner: -
--

CREATE INDEX idx_associate_job_titles_associate ON migration.associate_job_titles USING btree (associate_id);


--
-- Name: idx_associate_notes_associate; Type: INDEX; Schema: migration; Owner: -
--

CREATE INDEX idx_associate_notes_associate ON migration.associate_notes USING btree (associate_id);


--
-- Name: idx_associate_roles_associate; Type: INDEX; Schema: migration; Owner: -
--

CREATE INDEX idx_associate_roles_associate ON migration.associate_roles USING btree (associate_id);


--
-- Name: idx_associate_service_communities_associate; Type: INDEX; Schema: migration; Owner: -
--

CREATE INDEX idx_associate_service_communities_associate ON migration.associate_service_communities USING btree (associate_id);


--
-- Name: idx_associate_social_media_associate; Type: INDEX; Schema: migration; Owner: -
--

CREATE INDEX idx_associate_social_media_associate ON migration.associate_social_media USING btree (associate_id);


--
-- Name: idx_core_listings_address_line; Type: INDEX; Schema: migration; Owner: -
--

CREATE INDEX idx_core_listings_address_line ON migration.core_listings USING btree (address_line);


--
-- Name: idx_core_listings_city_trgm; Type: INDEX; Schema: migration; Owner: -
--

CREATE INDEX idx_core_listings_city_trgm ON migration.core_listings USING gin (city public.gin_trgm_ops);


--
-- Name: idx_core_listings_created_at; Type: INDEX; Schema: migration; Owner: -
--

CREATE INDEX idx_core_listings_created_at ON migration.core_listings USING btree (created_at DESC);


--
-- Name: idx_core_listings_listing_number; Type: INDEX; Schema: migration; Owner: -
--

CREATE INDEX idx_core_listings_listing_number ON migration.core_listings USING btree (listing_number);


--
-- Name: idx_core_listings_market_center_id; Type: INDEX; Schema: migration; Owner: -
--

CREATE INDEX idx_core_listings_market_center_id ON migration.core_listings USING btree (market_center_id);


--
-- Name: idx_core_listings_property_type; Type: INDEX; Schema: migration; Owner: -
--

CREATE INDEX idx_core_listings_property_type ON migration.core_listings USING btree (property_type);


--
-- Name: idx_core_listings_sale_or_rent; Type: INDEX; Schema: migration; Owner: -
--

CREATE INDEX idx_core_listings_sale_or_rent ON migration.core_listings USING btree (lower(TRIM(BOTH FROM COALESCE(sale_or_rent, ''::text))));


--
-- Name: idx_core_listings_status_name; Type: INDEX; Schema: migration; Owner: -
--

CREATE INDEX idx_core_listings_status_name ON migration.core_listings USING btree (lower(TRIM(BOTH FROM COALESCE(status_name, ''::text))));


--
-- Name: idx_core_listings_street_name_trgm; Type: INDEX; Schema: migration; Owner: -
--

CREATE INDEX idx_core_listings_street_name_trgm ON migration.core_listings USING gin (street_name public.gin_trgm_ops);


--
-- Name: idx_core_listings_suburb_trgm; Type: INDEX; Schema: migration; Owner: -
--

CREATE INDEX idx_core_listings_suburb_trgm ON migration.core_listings USING gin (suburb public.gin_trgm_ops);


--
-- Name: idx_core_transactions_date; Type: INDEX; Schema: migration; Owner: -
--

CREATE INDEX idx_core_transactions_date ON migration.core_transactions USING btree (transaction_date);


--
-- Name: idx_core_transactions_status; Type: INDEX; Schema: migration; Owner: -
--

CREATE INDEX idx_core_transactions_status ON migration.core_transactions USING btree (transaction_status);


--
-- Name: idx_in_app_notifications_associate; Type: INDEX; Schema: migration; Owner: -
--

CREATE INDEX idx_in_app_notifications_associate ON migration.in_app_notifications USING btree (associate_id, created_at DESC);


--
-- Name: idx_in_app_notifications_category; Type: INDEX; Schema: migration; Owner: -
--

CREATE INDEX idx_in_app_notifications_category ON migration.in_app_notifications USING btree (category);


--
-- Name: idx_listing_agents_associate; Type: INDEX; Schema: migration; Owner: -
--

CREATE INDEX idx_listing_agents_associate ON migration.listing_agents USING btree (associate_id);


--
-- Name: idx_listing_agents_listing; Type: INDEX; Schema: migration; Owner: -
--

CREATE INDEX idx_listing_agents_listing ON migration.listing_agents USING btree (listing_id);


--
-- Name: idx_listing_agents_name_trgm; Type: INDEX; Schema: migration; Owner: -
--

CREATE INDEX idx_listing_agents_name_trgm ON migration.listing_agents USING gin (agent_name public.gin_trgm_ops);


--
-- Name: idx_listing_agents_primary_lookup; Type: INDEX; Schema: migration; Owner: -
--

CREATE INDEX idx_listing_agents_primary_lookup ON migration.listing_agents USING btree (listing_id, is_primary DESC, sort_order, id);


--
-- Name: idx_listing_approval_requests_listing; Type: INDEX; Schema: migration; Owner: -
--

CREATE INDEX idx_listing_approval_requests_listing ON migration.listing_approval_requests USING btree (listing_id);


--
-- Name: idx_listing_approval_requests_status; Type: INDEX; Schema: migration; Owner: -
--

CREATE INDEX idx_listing_approval_requests_status ON migration.listing_approval_requests USING btree (status);


--
-- Name: idx_listing_contacts_email_trgm; Type: INDEX; Schema: migration; Owner: -
--

CREATE INDEX idx_listing_contacts_email_trgm ON migration.listing_contacts USING gin (email_address public.gin_trgm_ops);


--
-- Name: idx_listing_contacts_full_name_trgm; Type: INDEX; Schema: migration; Owner: -
--

CREATE INDEX idx_listing_contacts_full_name_trgm ON migration.listing_contacts USING gin (full_name public.gin_trgm_ops);


--
-- Name: idx_listing_contacts_listing; Type: INDEX; Schema: migration; Owner: -
--

CREATE INDEX idx_listing_contacts_listing ON migration.listing_contacts USING btree (listing_id);


--
-- Name: idx_listing_contacts_phone_trgm; Type: INDEX; Schema: migration; Owner: -
--

CREATE INDEX idx_listing_contacts_phone_trgm ON migration.listing_contacts USING gin (phone_number public.gin_trgm_ops);


--
-- Name: idx_listing_contacts_primary_lookup; Type: INDEX; Schema: migration; Owner: -
--

CREATE INDEX idx_listing_contacts_primary_lookup ON migration.listing_contacts USING btree (listing_id, id);


--
-- Name: idx_listing_features_category; Type: INDEX; Schema: migration; Owner: -
--

CREATE INDEX idx_listing_features_category ON migration.listing_features USING btree (listing_id, feature_category);


--
-- Name: idx_listing_features_listing; Type: INDEX; Schema: migration; Owner: -
--

CREATE INDEX idx_listing_features_listing ON migration.listing_features USING btree (listing_id);


--
-- Name: idx_listing_features_lookup; Type: INDEX; Schema: migration; Owner: -
--

CREATE INDEX idx_listing_features_lookup ON migration.listing_features USING btree (listing_id, lower(TRIM(BOTH FROM COALESCE(feature_category, ''::text))), lower(TRIM(BOTH FROM COALESCE(feature_value, ''::text))));


--
-- Name: idx_listing_images_listing; Type: INDEX; Schema: migration; Owner: -
--

CREATE INDEX idx_listing_images_listing ON migration.listing_images USING btree (listing_id);


--
-- Name: idx_listing_mandate_docs_listing; Type: INDEX; Schema: migration; Owner: -
--

CREATE INDEX idx_listing_mandate_docs_listing ON migration.listing_mandate_documents USING btree (listing_id);


--
-- Name: idx_listing_marketing_urls_listing; Type: INDEX; Schema: migration; Owner: -
--

CREATE INDEX idx_listing_marketing_urls_listing ON migration.listing_marketing_urls USING btree (listing_id);


--
-- Name: idx_listing_open_house_listing; Type: INDEX; Schema: migration; Owner: -
--

CREATE INDEX idx_listing_open_house_listing ON migration.listing_open_house USING btree (listing_id);


--
-- Name: idx_listing_property_areas_listing; Type: INDEX; Schema: migration; Owner: -
--

CREATE INDEX idx_listing_property_areas_listing ON migration.listing_property_areas USING btree (listing_id);


--
-- Name: idx_listing_property_areas_listing_type; Type: INDEX; Schema: migration; Owner: -
--

CREATE INDEX idx_listing_property_areas_listing_type ON migration.listing_property_areas USING btree (listing_id, lower(TRIM(BOTH FROM COALESCE(area_type, ''::text))));


--
-- Name: idx_listing_show_times_listing; Type: INDEX; Schema: migration; Owner: -
--

CREATE INDEX idx_listing_show_times_listing ON migration.listing_show_times USING btree (listing_id);


--
-- Name: idx_market_center_notes_market_center; Type: INDEX; Schema: migration; Owner: -
--

CREATE INDEX idx_market_center_notes_market_center ON migration.market_center_notes USING btree (market_center_id);


--
-- Name: idx_migration_ta_assoc; Type: INDEX; Schema: migration; Owner: -
--

CREATE INDEX idx_migration_ta_assoc ON migration.transaction_agents USING btree (associate_id);


--
-- Name: idx_migration_ta_tx; Type: INDEX; Schema: migration; Owner: -
--

CREATE INDEX idx_migration_ta_tx ON migration.transaction_agents USING btree (transaction_id);


--
-- Name: idx_outside_agency_tx; Type: INDEX; Schema: migration; Owner: -
--

CREATE INDEX idx_outside_agency_tx ON migration.outside_agency_contacts USING btree (transaction_id);


--
-- Name: idx_tac_assoc; Type: INDEX; Schema: migration; Owner: -
--

CREATE INDEX idx_tac_assoc ON migration.transaction_agent_calculations USING btree (associate_id);


--
-- Name: idx_tac_report_dt; Type: INDEX; Schema: migration; Owner: -
--

CREATE INDEX idx_tac_report_dt ON migration.transaction_agent_calculations USING btree (effective_reporting_date);


--
-- Name: idx_tac_ta; Type: INDEX; Schema: migration; Owner: -
--

CREATE INDEX idx_tac_ta ON migration.transaction_agent_calculations USING btree (transaction_agent_id);


--
-- Name: idx_tac_tx; Type: INDEX; Schema: migration; Owner: -
--

CREATE INDEX idx_tac_tx ON migration.transaction_agent_calculations USING btree (transaction_id);


--
-- Name: idx_transaction_agents_associate; Type: INDEX; Schema: migration; Owner: -
--

CREATE INDEX idx_transaction_agents_associate ON migration.transaction_agents USING btree (associate_id);


--
-- Name: idx_transaction_agents_transaction; Type: INDEX; Schema: migration; Owner: -
--

CREATE INDEX idx_transaction_agents_transaction ON migration.transaction_agents USING btree (transaction_id);


--
-- Name: idx_tx_calc_associate_id; Type: INDEX; Schema: migration; Owner: -
--

CREATE INDEX idx_tx_calc_associate_id ON migration.transaction_agent_calculations USING btree (associate_id);


--
-- Name: idx_tx_calc_office; Type: INDEX; Schema: migration; Owner: -
--

CREATE INDEX idx_tx_calc_office ON migration.transaction_agent_calculations USING btree (office_name);


--
-- Name: idx_tx_calc_registered; Type: INDEX; Schema: migration; Owner: -
--

CREATE INDEX idx_tx_calc_registered ON migration.transaction_agent_calculations USING btree (is_registered);


--
-- Name: idx_tx_calc_reporting_date; Type: INDEX; Schema: migration; Owner: -
--

CREATE INDEX idx_tx_calc_reporting_date ON migration.transaction_agent_calculations USING btree (effective_reporting_date);


--
-- Name: idx_tx_calc_transaction_id; Type: INDEX; Schema: migration; Owner: -
--

CREATE INDEX idx_tx_calc_transaction_id ON migration.transaction_agent_calculations USING btree (transaction_id);


--
-- Name: idx_tx_documents_tx; Type: INDEX; Schema: migration; Owner: -
--

CREATE INDEX idx_tx_documents_tx ON migration.transaction_documents USING btree (transaction_id) WHERE (deleted_at IS NULL);


--
-- Name: idx_tx_status_history_tx; Type: INDEX; Schema: migration; Owner: -
--

CREATE INDEX idx_tx_status_history_tx ON migration.transaction_status_history USING btree (transaction_id, changed_at DESC);


--
-- Name: mc_document_hub_mc_idx; Type: INDEX; Schema: migration; Owner: -
--

CREATE INDEX mc_document_hub_mc_idx ON migration.mc_document_hub USING btree (source_market_center_id);


--
-- Name: uq_listing_images_listing_id_file_url; Type: INDEX; Schema: migration; Owner: -
--

CREATE UNIQUE INDEX uq_listing_images_listing_id_file_url ON migration.listing_images USING btree (listing_id, file_url);


--
-- Name: addresses_cityId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "addresses_cityId_idx" ON public.addresses USING btree ("cityId");


--
-- Name: addresses_suburbId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "addresses_suburbId_idx" ON public.addresses USING btree ("suburbId");


--
-- Name: associate_business_details_associateId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "associate_business_details_associateId_key" ON public.associate_business_details USING btree ("associateId");


--
-- Name: associate_contact_details_associateId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "associate_contact_details_associateId_key" ON public.associate_contact_details USING btree ("associateId");


--
-- Name: associate_third_party_integrations_associateId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "associate_third_party_integrations_associateId_key" ON public.associate_third_party_integrations USING btree ("associateId");


--
-- Name: associate_transfers_associateId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "associate_transfers_associateId_idx" ON public.associate_transfers USING btree ("associateId");


--
-- Name: associate_transfers_transferStatusId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "associate_transfers_transferStatusId_idx" ON public.associate_transfers USING btree ("transferStatusId");


--
-- Name: associates_marketCenterId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "associates_marketCenterId_idx" ON public.associates USING btree ("marketCenterId");


--
-- Name: associates_statusId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "associates_statusId_idx" ON public.associates USING btree ("statusId");


--
-- Name: associates_teamId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "associates_teamId_idx" ON public.associates USING btree ("teamId");


--
-- Name: associates_userId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "associates_userId_key" ON public.associates USING btree ("userId");


--
-- Name: audit_logs_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "audit_logs_createdAt_idx" ON public.audit_logs USING btree ("createdAt");


--
-- Name: audit_logs_entity_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_logs_entity_idx ON public.audit_logs USING btree (entity);


--
-- Name: audit_logs_userId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "audit_logs_userId_idx" ON public.audit_logs USING btree ("userId");


--
-- Name: cities_p24Id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "cities_p24Id_idx" ON public.cities USING btree ("p24Id");


--
-- Name: cities_p24Id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "cities_p24Id_key" ON public.cities USING btree ("p24Id");


--
-- Name: cities_provinceId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "cities_provinceId_idx" ON public.cities USING btree ("provinceId");


--
-- Name: countries_p24Id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "countries_p24Id_idx" ON public.countries USING btree ("p24Id");


--
-- Name: countries_p24Id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "countries_p24Id_key" ON public.countries USING btree ("p24Id");


--
-- Name: idx_addresses_suburb_street; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_addresses_suburb_street ON public.addresses USING btree ("suburbId", "streetNumber", "streetName");


--
-- Name: listing_associates_listingId_associateId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "listing_associates_listingId_associateId_key" ON public.listing_associates USING btree ("listingId", "associateId");


--
-- Name: listing_building_infos_listingId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "listing_building_infos_listingId_key" ON public.listing_building_infos USING btree ("listingId");


--
-- Name: listing_descriptions_listingId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "listing_descriptions_listingId_key" ON public.listing_descriptions USING btree ("listingId");


--
-- Name: listing_images_listingId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "listing_images_listingId_idx" ON public.listing_images USING btree ("listingId");


--
-- Name: listing_lightstone_validations_listingId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "listing_lightstone_validations_listingId_key" ON public.listing_lightstone_validations USING btree ("listingId");


--
-- Name: listing_mandate_infos_listingId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "listing_mandate_infos_listingId_key" ON public.listing_mandate_infos USING btree ("listingId");


--
-- Name: listing_p24_feed_items_listingId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "listing_p24_feed_items_listingId_idx" ON public.listing_p24_feed_items USING btree ("listingId");


--
-- Name: listing_p24_feed_items_statusId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "listing_p24_feed_items_statusId_idx" ON public.listing_p24_feed_items USING btree ("statusId");


--
-- Name: listing_price_details_listingId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "listing_price_details_listingId_key" ON public.listing_price_details USING btree ("listingId");


--
-- Name: listing_third_party_integrations_listingId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "listing_third_party_integrations_listingId_key" ON public.listing_third_party_integrations USING btree ("listingId");


--
-- Name: listings_addressId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "listings_addressId_idx" ON public.listings USING btree ("addressId");


--
-- Name: listings_listingNumber_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "listings_listingNumber_key" ON public.listings USING btree ("listingNumber");


--
-- Name: listings_marketCenterId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "listings_marketCenterId_idx" ON public.listings USING btree ("marketCenterId");


--
-- Name: listings_statusId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "listings_statusId_idx" ON public.listings USING btree ("statusId");


--
-- Name: loom_user_tokens_email_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX loom_user_tokens_email_idx ON public.loom_user_tokens USING btree (user_email);


--
-- Name: market_centers_addressId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "market_centers_addressId_idx" ON public.market_centers USING btree ("addressId");


--
-- Name: market_centers_statusId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "market_centers_statusId_idx" ON public.market_centers USING btree ("statusId");


--
-- Name: provinces_countryId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "provinces_countryId_idx" ON public.provinces USING btree ("countryId");


--
-- Name: provinces_p24Id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "provinces_p24Id_idx" ON public.provinces USING btree ("p24Id");


--
-- Name: provinces_p24Id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "provinces_p24Id_key" ON public.provinces USING btree ("p24Id");


--
-- Name: roles_name_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX roles_name_key ON public.roles USING btree (name);


--
-- Name: suburbs_cityId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "suburbs_cityId_idx" ON public.suburbs USING btree ("cityId");


--
-- Name: suburbs_p24Id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "suburbs_p24Id_idx" ON public.suburbs USING btree ("p24Id");


--
-- Name: suburbs_p24Id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "suburbs_p24Id_key" ON public.suburbs USING btree ("p24Id");


--
-- Name: teams_marketCenterId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "teams_marketCenterId_idx" ON public.teams USING btree ("marketCenterId");


--
-- Name: teams_statusId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "teams_statusId_idx" ON public.teams USING btree ("statusId");


--
-- Name: transaction_associate_payment_details_transactionAssociateI_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "transaction_associate_payment_details_transactionAssociateI_key" ON public.transaction_associate_payment_details USING btree ("transactionAssociateId");


--
-- Name: transaction_associates_associateId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "transaction_associates_associateId_idx" ON public.transaction_associates USING btree ("associateId");


--
-- Name: transaction_associates_transactionId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "transaction_associates_transactionId_idx" ON public.transaction_associates USING btree ("transactionId");


--
-- Name: transaction_bonds_transactionId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "transaction_bonds_transactionId_key" ON public.transaction_bonds USING btree ("transactionId");


--
-- Name: transaction_descriptions_transactionId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "transaction_descriptions_transactionId_key" ON public.transaction_descriptions USING btree ("transactionId");


--
-- Name: transactions_listingId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "transactions_listingId_idx" ON public.transactions USING btree ("listingId");


--
-- Name: transactions_statusId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "transactions_statusId_idx" ON public.transactions USING btree ("statusId");


--
-- Name: transactions_transactionNumber_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "transactions_transactionNumber_key" ON public.transactions USING btree ("transactionNumber");


--
-- Name: users_email_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX users_email_idx ON public.users USING btree (email);


--
-- Name: users_email_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX users_email_key ON public.users USING btree (email);


--
-- Name: idx_associate_docs_assoc; Type: INDEX; Schema: staging; Owner: -
--

CREATE INDEX idx_associate_docs_assoc ON staging.associate_documents_raw USING btree (source_associate_id);


--
-- Name: idx_associate_documents_raw_assoc; Type: INDEX; Schema: staging; Owner: -
--

CREATE INDEX idx_associate_documents_raw_assoc ON staging.associate_documents_raw USING btree (source_associate_id);


--
-- Name: idx_associates_raw_batch; Type: INDEX; Schema: staging; Owner: -
--

CREATE INDEX idx_associates_raw_batch ON staging.associates_raw USING btree (batch_id);


--
-- Name: idx_associates_raw_source; Type: INDEX; Schema: staging; Owner: -
--

CREATE INDEX idx_associates_raw_source ON staging.associates_raw USING btree (source_associate_id);


--
-- Name: idx_listing_area_listing; Type: INDEX; Schema: staging; Owner: -
--

CREATE INDEX idx_listing_area_listing ON staging.listing_property_areas_raw USING btree (source_listing_id);


--
-- Name: idx_listing_docs_listing; Type: INDEX; Schema: staging; Owner: -
--

CREATE INDEX idx_listing_docs_listing ON staging.listing_documents_raw USING btree (source_listing_id);


--
-- Name: idx_listing_documents_raw_listing; Type: INDEX; Schema: staging; Owner: -
--

CREATE INDEX idx_listing_documents_raw_listing ON staging.listing_documents_raw USING btree (source_listing_id);


--
-- Name: idx_listing_features_listing; Type: INDEX; Schema: staging; Owner: -
--

CREATE INDEX idx_listing_features_listing ON staging.listing_features_raw USING btree (source_listing_id);


--
-- Name: idx_listing_features_raw_listing; Type: INDEX; Schema: staging; Owner: -
--

CREATE INDEX idx_listing_features_raw_listing ON staging.listing_features_raw USING btree (source_listing_id);


--
-- Name: idx_listing_images_raw_listing; Type: INDEX; Schema: staging; Owner: -
--

CREATE INDEX idx_listing_images_raw_listing ON staging.listing_images_raw USING btree (source_listing_id);


--
-- Name: idx_listing_mkt_urls_listing; Type: INDEX; Schema: staging; Owner: -
--

CREATE INDEX idx_listing_mkt_urls_listing ON staging.listing_marketing_urls_raw USING btree (source_listing_id);


--
-- Name: idx_listing_p24_feed_items_raw_listing; Type: INDEX; Schema: staging; Owner: -
--

CREATE INDEX idx_listing_p24_feed_items_raw_listing ON staging.listing_p24_feed_items_raw USING btree (source_listing_id);


--
-- Name: idx_listing_p24_feed_listing; Type: INDEX; Schema: staging; Owner: -
--

CREATE INDEX idx_listing_p24_feed_listing ON staging.listing_p24_feed_items_raw USING btree (source_listing_id);


--
-- Name: idx_listing_property_areas_raw_listing; Type: INDEX; Schema: staging; Owner: -
--

CREATE INDEX idx_listing_property_areas_raw_listing ON staging.listing_property_areas_raw USING btree (source_listing_id);


--
-- Name: idx_listings_raw_batch; Type: INDEX; Schema: staging; Owner: -
--

CREATE INDEX idx_listings_raw_batch ON staging.listings_raw USING btree (batch_id);


--
-- Name: idx_listings_raw_source; Type: INDEX; Schema: staging; Owner: -
--

CREATE INDEX idx_listings_raw_source ON staging.listings_raw USING btree (source_listing_id);


--
-- Name: idx_market_centers_raw_batch; Type: INDEX; Schema: staging; Owner: -
--

CREATE INDEX idx_market_centers_raw_batch ON staging.market_centers_raw USING btree (batch_id);


--
-- Name: idx_market_centers_raw_source; Type: INDEX; Schema: staging; Owner: -
--

CREATE INDEX idx_market_centers_raw_source ON staging.market_centers_raw USING btree (source_market_center_id);


--
-- Name: idx_pfrn_listing_number; Type: INDEX; Schema: staging; Owner: -
--

CREATE INDEX idx_pfrn_listing_number ON staging.portal_fields_raw_norm USING btree (listing_number);


--
-- Name: idx_pfrn_source_listing_id; Type: INDEX; Schema: staging; Owner: -
--

CREATE INDEX idx_pfrn_source_listing_id ON staging.portal_fields_raw_norm USING btree (source_listing_id);


--
-- Name: idx_ssms_listing_area_features_flat_number; Type: INDEX; Schema: staging; Owner: -
--

CREATE INDEX idx_ssms_listing_area_features_flat_number ON staging.ssms_listing_area_features_flat_raw USING btree (listing_number);


--
-- Name: idx_ssms_listing_area_features_flat_source; Type: INDEX; Schema: staging; Owner: -
--

CREATE INDEX idx_ssms_listing_area_features_flat_source ON staging.ssms_listing_area_features_flat_raw USING btree (source_listing_id);


--
-- Name: idx_ssms_listing_building_features_number; Type: INDEX; Schema: staging; Owner: -
--

CREATE INDEX idx_ssms_listing_building_features_number ON staging.ssms_listing_building_area_features_raw USING btree (listing_number);


--
-- Name: idx_ssms_listing_building_features_source; Type: INDEX; Schema: staging; Owner: -
--

CREATE INDEX idx_ssms_listing_building_features_source ON staging.ssms_listing_building_area_features_raw USING btree (source_listing_id);


--
-- Name: idx_ssms_listing_building_info_number; Type: INDEX; Schema: staging; Owner: -
--

CREATE INDEX idx_ssms_listing_building_info_number ON staging.ssms_listing_building_info_raw USING btree (listing_number);


--
-- Name: idx_ssms_listing_building_info_source; Type: INDEX; Schema: staging; Owner: -
--

CREATE INDEX idx_ssms_listing_building_info_source ON staging.ssms_listing_building_info_raw USING btree (source_listing_id);


--
-- Name: idx_ssms_listing_details_number; Type: INDEX; Schema: staging; Owner: -
--

CREATE INDEX idx_ssms_listing_details_number ON staging.ssms_listing_details_raw USING btree (listing_number);


--
-- Name: idx_ssms_listing_details_source; Type: INDEX; Schema: staging; Owner: -
--

CREATE INDEX idx_ssms_listing_details_source ON staging.ssms_listing_details_raw USING btree (source_listing_id);


--
-- Name: idx_ssms_listing_internet_number; Type: INDEX; Schema: staging; Owner: -
--

CREATE INDEX idx_ssms_listing_internet_number ON staging.ssms_listing_building_info_internet_raw USING btree (listing_number);


--
-- Name: idx_ssms_listing_internet_source; Type: INDEX; Schema: staging; Owner: -
--

CREATE INDEX idx_ssms_listing_internet_source ON staging.ssms_listing_building_info_internet_raw USING btree (source_listing_id);


--
-- Name: idx_ssms_listing_property_area_features_number; Type: INDEX; Schema: staging; Owner: -
--

CREATE INDEX idx_ssms_listing_property_area_features_number ON staging.ssms_listing_property_area_features_raw USING btree (listing_number);


--
-- Name: idx_ssms_listing_property_area_features_source; Type: INDEX; Schema: staging; Owner: -
--

CREATE INDEX idx_ssms_listing_property_area_features_source ON staging.ssms_listing_property_area_features_raw USING btree (source_listing_id);


--
-- Name: idx_ssms_listing_property_areas_number; Type: INDEX; Schema: staging; Owner: -
--

CREATE INDEX idx_ssms_listing_property_areas_number ON staging.ssms_listing_property_areas_raw USING btree (listing_number);


--
-- Name: idx_ssms_listing_property_areas_source; Type: INDEX; Schema: staging; Owner: -
--

CREATE INDEX idx_ssms_listing_property_areas_source ON staging.ssms_listing_property_areas_raw USING btree (source_listing_id);


--
-- Name: idx_ssms_listing_sustainability_number; Type: INDEX; Schema: staging; Owner: -
--

CREATE INDEX idx_ssms_listing_sustainability_number ON staging.ssms_listing_building_info_sustainability_raw USING btree (listing_number);


--
-- Name: idx_ssms_listing_sustainability_source; Type: INDEX; Schema: staging; Owner: -
--

CREATE INDEX idx_ssms_listing_sustainability_source ON staging.ssms_listing_building_info_sustainability_raw USING btree (source_listing_id);


--
-- Name: idx_ssms_listing_transport_number; Type: INDEX; Schema: staging; Owner: -
--

CREATE INDEX idx_ssms_listing_transport_number ON staging.ssms_listing_building_info_public_transport_raw USING btree (listing_number);


--
-- Name: idx_ssms_listing_transport_source; Type: INDEX; Schema: staging; Owner: -
--

CREATE INDEX idx_ssms_listing_transport_source ON staging.ssms_listing_building_info_public_transport_raw USING btree (source_listing_id);


--
-- Name: idx_staging_transaction_agents_associate; Type: INDEX; Schema: staging; Owner: -
--

CREATE INDEX idx_staging_transaction_agents_associate ON staging.transaction_agents USING btree (source_associate_id);


--
-- Name: idx_staging_transaction_agents_tx; Type: INDEX; Schema: staging; Owner: -
--

CREATE INDEX idx_staging_transaction_agents_tx ON staging.transaction_agents USING btree (transaction_id);


--
-- Name: idx_teams_raw_batch; Type: INDEX; Schema: staging; Owner: -
--

CREATE INDEX idx_teams_raw_batch ON staging.teams_raw USING btree (batch_id);


--
-- Name: idx_teams_raw_mc; Type: INDEX; Schema: staging; Owner: -
--

CREATE INDEX idx_teams_raw_mc ON staging.teams_raw USING btree (source_market_center_id);


--
-- Name: idx_teams_raw_source; Type: INDEX; Schema: staging; Owner: -
--

CREATE INDEX idx_teams_raw_source ON staging.teams_raw USING btree (source_team_id);


--
-- Name: idx_transaction_agents_assoc; Type: INDEX; Schema: staging; Owner: -
--

CREATE INDEX idx_transaction_agents_assoc ON staging.transaction_agents USING btree (source_associate_id);


--
-- Name: idx_transaction_agents_tx; Type: INDEX; Schema: staging; Owner: -
--

CREATE INDEX idx_transaction_agents_tx ON staging.transaction_agents USING btree (transaction_id);


--
-- Name: idx_transaction_bonds_tx; Type: INDEX; Schema: staging; Owner: -
--

CREATE INDEX idx_transaction_bonds_tx ON staging.transaction_bonds USING btree (source_transaction_id);


--
-- Name: idx_transaction_contacts_raw_tx; Type: INDEX; Schema: staging; Owner: -
--

CREATE INDEX idx_transaction_contacts_raw_tx ON staging.transaction_contacts_raw USING btree (source_transaction_id);


--
-- Name: idx_transaction_documents_raw_tx; Type: INDEX; Schema: staging; Owner: -
--

CREATE INDEX idx_transaction_documents_raw_tx ON staging.transaction_documents_raw USING btree (source_transaction_id);


--
-- Name: idx_transaction_notes_tx; Type: INDEX; Schema: staging; Owner: -
--

CREATE INDEX idx_transaction_notes_tx ON staging.transaction_notes USING btree (source_transaction_id);


--
-- Name: idx_transactions_raw_associate; Type: INDEX; Schema: staging; Owner: -
--

CREATE INDEX idx_transactions_raw_associate ON staging.transactions_raw USING btree (source_associate_id);


--
-- Name: idx_transactions_raw_batch; Type: INDEX; Schema: staging; Owner: -
--

CREATE INDEX idx_transactions_raw_batch ON staging.transactions_raw USING btree (batch_id);


--
-- Name: idx_transactions_raw_mc; Type: INDEX; Schema: staging; Owner: -
--

CREATE INDEX idx_transactions_raw_mc ON staging.transactions_raw USING btree (source_market_center_id);


--
-- Name: idx_transactions_raw_source; Type: INDEX; Schema: staging; Owner: -
--

CREATE INDEX idx_transactions_raw_source ON staging.transactions_raw USING btree (source_transaction_id);


--
-- Name: idx_tx_contacts_tx; Type: INDEX; Schema: staging; Owner: -
--

CREATE INDEX idx_tx_contacts_tx ON staging.transaction_contacts_raw USING btree (source_transaction_id);


--
-- Name: idx_tx_docs_tx; Type: INDEX; Schema: staging; Owner: -
--

CREATE INDEX idx_tx_docs_tx ON staging.transaction_documents_raw USING btree (source_transaction_id);


--
-- Name: rental_audit_log rental_audit_log_payment_schedule_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.rental_audit_log
    ADD CONSTRAINT rental_audit_log_payment_schedule_id_fkey FOREIGN KEY (payment_schedule_id) REFERENCES app.rental_payment_schedule(id) ON DELETE SET NULL;


--
-- Name: rental_audit_log rental_audit_log_rental_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.rental_audit_log
    ADD CONSTRAINT rental_audit_log_rental_id_fkey FOREIGN KEY (rental_id) REFERENCES app.rentals(id) ON DELETE SET NULL;


--
-- Name: rental_documents rental_documents_rental_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.rental_documents
    ADD CONSTRAINT rental_documents_rental_id_fkey FOREIGN KEY (rental_id) REFERENCES app.rentals(id) ON DELETE CASCADE;


--
-- Name: rental_participants rental_participants_rental_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.rental_participants
    ADD CONSTRAINT rental_participants_rental_id_fkey FOREIGN KEY (rental_id) REFERENCES app.rentals(id) ON DELETE CASCADE;


--
-- Name: rental_payment_schedule rental_payment_schedule_rental_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.rental_payment_schedule
    ADD CONSTRAINT rental_payment_schedule_rental_id_fkey FOREIGN KEY (rental_id) REFERENCES app.rentals(id) ON DELETE CASCADE;


--
-- Name: in_app_notifications in_app_notifications_associate_id_fkey; Type: FK CONSTRAINT; Schema: migration; Owner: -
--

ALTER TABLE ONLY migration.in_app_notifications
    ADD CONSTRAINT in_app_notifications_associate_id_fkey FOREIGN KEY (associate_id) REFERENCES migration.core_associates(id) ON DELETE CASCADE;


--
-- Name: listing_approval_requests listing_approval_requests_listing_id_fkey; Type: FK CONSTRAINT; Schema: migration; Owner: -
--

ALTER TABLE ONLY migration.listing_approval_requests
    ADD CONSTRAINT listing_approval_requests_listing_id_fkey FOREIGN KEY (listing_id) REFERENCES migration.core_listings(id) ON DELETE CASCADE;


--
-- Name: listing_approval_requests listing_approval_requests_reviewed_by_associate_id_fkey; Type: FK CONSTRAINT; Schema: migration; Owner: -
--

ALTER TABLE ONLY migration.listing_approval_requests
    ADD CONSTRAINT listing_approval_requests_reviewed_by_associate_id_fkey FOREIGN KEY (reviewed_by_associate_id) REFERENCES migration.core_associates(id) ON DELETE SET NULL;


--
-- Name: listing_approval_requests listing_approval_requests_submitted_by_associate_id_fkey; Type: FK CONSTRAINT; Schema: migration; Owner: -
--

ALTER TABLE ONLY migration.listing_approval_requests
    ADD CONSTRAINT listing_approval_requests_submitted_by_associate_id_fkey FOREIGN KEY (submitted_by_associate_id) REFERENCES migration.core_associates(id) ON DELETE SET NULL;


--
-- Name: market_center_notes market_center_notes_market_center_id_fkey; Type: FK CONSTRAINT; Schema: migration; Owner: -
--

ALTER TABLE ONLY migration.market_center_notes
    ADD CONSTRAINT market_center_notes_market_center_id_fkey FOREIGN KEY (market_center_id) REFERENCES migration.core_market_centers(id) ON DELETE CASCADE;


--
-- Name: outside_agency_contacts outside_agency_contacts_transaction_agent_id_fkey; Type: FK CONSTRAINT; Schema: migration; Owner: -
--

ALTER TABLE ONLY migration.outside_agency_contacts
    ADD CONSTRAINT outside_agency_contacts_transaction_agent_id_fkey FOREIGN KEY (transaction_agent_id) REFERENCES migration.transaction_agents(id) ON DELETE CASCADE;


--
-- Name: outside_agency_contacts outside_agency_contacts_transaction_id_fkey; Type: FK CONSTRAINT; Schema: migration; Owner: -
--

ALTER TABLE ONLY migration.outside_agency_contacts
    ADD CONSTRAINT outside_agency_contacts_transaction_id_fkey FOREIGN KEY (transaction_id) REFERENCES migration.core_transactions(id) ON DELETE CASCADE;


--
-- Name: team_associate_commissions team_associate_commissions_team_id_fkey; Type: FK CONSTRAINT; Schema: migration; Owner: -
--

ALTER TABLE ONLY migration.team_associate_commissions
    ADD CONSTRAINT team_associate_commissions_team_id_fkey FOREIGN KEY (team_id) REFERENCES migration.core_teams(id) ON DELETE CASCADE;


--
-- Name: team_cap_history team_cap_history_team_id_fkey; Type: FK CONSTRAINT; Schema: migration; Owner: -
--

ALTER TABLE ONLY migration.team_cap_history
    ADD CONSTRAINT team_cap_history_team_id_fkey FOREIGN KEY (team_id) REFERENCES migration.core_teams(id) ON DELETE CASCADE;


--
-- Name: team_caps team_caps_team_id_fkey; Type: FK CONSTRAINT; Schema: migration; Owner: -
--

ALTER TABLE ONLY migration.team_caps
    ADD CONSTRAINT team_caps_team_id_fkey FOREIGN KEY (team_id) REFERENCES migration.core_teams(id) ON DELETE CASCADE;


--
-- Name: team_dates team_dates_team_id_fkey; Type: FK CONSTRAINT; Schema: migration; Owner: -
--

ALTER TABLE ONLY migration.team_dates
    ADD CONSTRAINT team_dates_team_id_fkey FOREIGN KEY (team_id) REFERENCES migration.core_teams(id) ON DELETE CASCADE;


--
-- Name: team_notes team_notes_team_id_fkey; Type: FK CONSTRAINT; Schema: migration; Owner: -
--

ALTER TABLE ONLY migration.team_notes
    ADD CONSTRAINT team_notes_team_id_fkey FOREIGN KEY (team_id) REFERENCES migration.core_teams(id) ON DELETE CASCADE;


--
-- Name: team_portal_settings team_portal_settings_team_id_fkey; Type: FK CONSTRAINT; Schema: migration; Owner: -
--

ALTER TABLE ONLY migration.team_portal_settings
    ADD CONSTRAINT team_portal_settings_team_id_fkey FOREIGN KEY (team_id) REFERENCES migration.core_teams(id) ON DELETE CASCADE;


--
-- Name: transaction_documents transaction_documents_transaction_id_fkey; Type: FK CONSTRAINT; Schema: migration; Owner: -
--

ALTER TABLE ONLY migration.transaction_documents
    ADD CONSTRAINT transaction_documents_transaction_id_fkey FOREIGN KEY (transaction_id) REFERENCES migration.core_transactions(id) ON DELETE CASCADE;


--
-- Name: transaction_status_history transaction_status_history_transaction_id_fkey; Type: FK CONSTRAINT; Schema: migration; Owner: -
--

ALTER TABLE ONLY migration.transaction_status_history
    ADD CONSTRAINT transaction_status_history_transaction_id_fkey FOREIGN KEY (transaction_id) REFERENCES migration.core_transactions(id) ON DELETE CASCADE;


--
-- Name: addresses addresses_cityId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.addresses
    ADD CONSTRAINT "addresses_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES public.cities(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: addresses addresses_countryId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.addresses
    ADD CONSTRAINT "addresses_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES public.countries(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: addresses addresses_provinceId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.addresses
    ADD CONSTRAINT "addresses_provinceId_fkey" FOREIGN KEY ("provinceId") REFERENCES public.provinces(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: addresses addresses_suburbId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.addresses
    ADD CONSTRAINT "addresses_suburbId_fkey" FOREIGN KEY ("suburbId") REFERENCES public.suburbs(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: associate_business_details associate_business_details_associateId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.associate_business_details
    ADD CONSTRAINT "associate_business_details_associateId_fkey" FOREIGN KEY ("associateId") REFERENCES public.associates(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: associate_business_details associate_business_details_growthShareSponsorId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.associate_business_details
    ADD CONSTRAINT "associate_business_details_growthShareSponsorId_fkey" FOREIGN KEY ("growthShareSponsorId") REFERENCES public.associates(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: associate_contact_details associate_contact_details_associateId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.associate_contact_details
    ADD CONSTRAINT "associate_contact_details_associateId_fkey" FOREIGN KEY ("associateId") REFERENCES public.associates(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: associate_third_party_integrations associate_third_party_integrations_associateId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.associate_third_party_integrations
    ADD CONSTRAINT "associate_third_party_integrations_associateId_fkey" FOREIGN KEY ("associateId") REFERENCES public.associates(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: associate_transfers associate_transfers_associateId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.associate_transfers
    ADD CONSTRAINT "associate_transfers_associateId_fkey" FOREIGN KEY ("associateId") REFERENCES public.associates(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: associate_transfers associate_transfers_transferStatusId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.associate_transfers
    ADD CONSTRAINT "associate_transfers_transferStatusId_fkey" FOREIGN KEY ("transferStatusId") REFERENCES public.associate_transfer_statuses(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: associates associates_marketCenterId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.associates
    ADD CONSTRAINT "associates_marketCenterId_fkey" FOREIGN KEY ("marketCenterId") REFERENCES public.market_centers(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: associates associates_statusId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.associates
    ADD CONSTRAINT "associates_statusId_fkey" FOREIGN KEY ("statusId") REFERENCES public.associate_statuses(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: associates associates_teamId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.associates
    ADD CONSTRAINT "associates_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES public.teams(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: associates associates_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.associates
    ADD CONSTRAINT "associates_userId_fkey" FOREIGN KEY ("userId") REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: cities cities_provinceId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cities
    ADD CONSTRAINT "cities_provinceId_fkey" FOREIGN KEY ("provinceId") REFERENCES public.provinces(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: listing_associates listing_associates_associateId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listing_associates
    ADD CONSTRAINT "listing_associates_associateId_fkey" FOREIGN KEY ("associateId") REFERENCES public.associates(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: listing_associates listing_associates_listingId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listing_associates
    ADD CONSTRAINT "listing_associates_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES public.listings(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: listing_building_area_features listing_building_area_features_buildingInfoId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listing_building_area_features
    ADD CONSTRAINT "listing_building_area_features_buildingInfoId_fkey" FOREIGN KEY ("buildingInfoId") REFERENCES public.listing_building_infos(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: listing_building_area_features listing_building_area_features_featureId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listing_building_area_features
    ADD CONSTRAINT "listing_building_area_features_featureId_fkey" FOREIGN KEY ("featureId") REFERENCES public.listing_building_area_feature_types(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: listing_building_infos listing_building_infos_listingId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listing_building_infos
    ADD CONSTRAINT "listing_building_infos_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES public.listings(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: listing_descriptions listing_descriptions_listingId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listing_descriptions
    ADD CONSTRAINT "listing_descriptions_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES public.listings(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: listing_descriptions listing_descriptions_listingTypeId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listing_descriptions
    ADD CONSTRAINT "listing_descriptions_listingTypeId_fkey" FOREIGN KEY ("listingTypeId") REFERENCES public.listing_types(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: listing_images listing_images_documentId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listing_images
    ADD CONSTRAINT "listing_images_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES public.documents(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: listing_images listing_images_listingId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listing_images
    ADD CONSTRAINT "listing_images_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES public.listings(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: listing_lightstone_validations listing_lightstone_validations_listingId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listing_lightstone_validations
    ADD CONSTRAINT "listing_lightstone_validations_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES public.listings(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: listing_mandate_infos listing_mandate_infos_listingId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listing_mandate_infos
    ADD CONSTRAINT "listing_mandate_infos_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES public.listings(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: listing_mandate_infos listing_mandate_infos_mandateTypeId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listing_mandate_infos
    ADD CONSTRAINT "listing_mandate_infos_mandateTypeId_fkey" FOREIGN KEY ("mandateTypeId") REFERENCES public.listing_mandate_types(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: listing_marketing_urls listing_marketing_urls_listingId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listing_marketing_urls
    ADD CONSTRAINT "listing_marketing_urls_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES public.listings(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: listing_marketing_urls listing_marketing_urls_marketingUrlTypeId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listing_marketing_urls
    ADD CONSTRAINT "listing_marketing_urls_marketingUrlTypeId_fkey" FOREIGN KEY ("marketingUrlTypeId") REFERENCES public.listing_marketing_url_types(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: listing_p24_feed_items listing_p24_feed_items_listingId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listing_p24_feed_items
    ADD CONSTRAINT "listing_p24_feed_items_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES public.listings(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: listing_p24_feed_items listing_p24_feed_items_statusId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listing_p24_feed_items
    ADD CONSTRAINT "listing_p24_feed_items_statusId_fkey" FOREIGN KEY ("statusId") REFERENCES public.listing_p24_feed_item_statuses(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: listing_price_details listing_price_details_listingId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listing_price_details
    ADD CONSTRAINT "listing_price_details_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES public.listings(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: listing_property_areas listing_property_areas_listingId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listing_property_areas
    ADD CONSTRAINT "listing_property_areas_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES public.listings(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: listing_property_areas listing_property_areas_propertyAreaTypeId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listing_property_areas
    ADD CONSTRAINT "listing_property_areas_propertyAreaTypeId_fkey" FOREIGN KEY ("propertyAreaTypeId") REFERENCES public.listing_property_area_types(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: listing_third_party_integrations listing_third_party_integrations_listingId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listing_third_party_integrations
    ADD CONSTRAINT "listing_third_party_integrations_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES public.listings(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: listings listings_addressId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listings
    ADD CONSTRAINT "listings_addressId_fkey" FOREIGN KEY ("addressId") REFERENCES public.addresses(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: listings listings_marketCenterId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listings
    ADD CONSTRAINT "listings_marketCenterId_fkey" FOREIGN KEY ("marketCenterId") REFERENCES public.market_centers(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: listings listings_saleOrRentTypeId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listings
    ADD CONSTRAINT "listings_saleOrRentTypeId_fkey" FOREIGN KEY ("saleOrRentTypeId") REFERENCES public.listing_sale_or_rent_types(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: listings listings_statusId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listings
    ADD CONSTRAINT "listings_statusId_fkey" FOREIGN KEY ("statusId") REFERENCES public.listing_statuses(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: listings listings_statusTagId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listings
    ADD CONSTRAINT "listings_statusTagId_fkey" FOREIGN KEY ("statusTagId") REFERENCES public.listing_status_tags(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: market_centers market_centers_addressId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_centers
    ADD CONSTRAINT "market_centers_addressId_fkey" FOREIGN KEY ("addressId") REFERENCES public.addresses(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: market_centers market_centers_statusId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_centers
    ADD CONSTRAINT "market_centers_statusId_fkey" FOREIGN KEY ("statusId") REFERENCES public.market_center_statuses(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: provinces provinces_countryId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.provinces
    ADD CONSTRAINT "provinces_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES public.countries(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: suburbs suburbs_cityId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.suburbs
    ADD CONSTRAINT "suburbs_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES public.cities(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: teams teams_marketCenterId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teams
    ADD CONSTRAINT "teams_marketCenterId_fkey" FOREIGN KEY ("marketCenterId") REFERENCES public.market_centers(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: teams teams_statusId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teams
    ADD CONSTRAINT "teams_statusId_fkey" FOREIGN KEY ("statusId") REFERENCES public.team_statuses(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: transaction_associate_payment_details transaction_associate_payment_details_transactionAssociate_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transaction_associate_payment_details
    ADD CONSTRAINT "transaction_associate_payment_details_transactionAssociate_fkey" FOREIGN KEY ("transactionAssociateId") REFERENCES public.transaction_associates(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: transaction_associates transaction_associates_associateId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transaction_associates
    ADD CONSTRAINT "transaction_associates_associateId_fkey" FOREIGN KEY ("associateId") REFERENCES public.associates(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: transaction_associates transaction_associates_contactId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transaction_associates
    ADD CONSTRAINT "transaction_associates_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES public.contacts(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: transaction_associates transaction_associates_transactionAssociateTypeId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transaction_associates
    ADD CONSTRAINT "transaction_associates_transactionAssociateTypeId_fkey" FOREIGN KEY ("transactionAssociateTypeId") REFERENCES public.transaction_associate_types(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: transaction_associates transaction_associates_transactionId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transaction_associates
    ADD CONSTRAINT "transaction_associates_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES public.transactions(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: transaction_bonds transaction_bonds_bondAttorneyId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transaction_bonds
    ADD CONSTRAINT "transaction_bonds_bondAttorneyId_fkey" FOREIGN KEY ("bondAttorneyId") REFERENCES public.contacts(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: transaction_bonds transaction_bonds_transactionFinancialInstitutionId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transaction_bonds
    ADD CONSTRAINT "transaction_bonds_transactionFinancialInstitutionId_fkey" FOREIGN KEY ("transactionFinancialInstitutionId") REFERENCES public.transaction_financial_institutions(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: transaction_bonds transaction_bonds_transactionFinancingChannelId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transaction_bonds
    ADD CONSTRAINT "transaction_bonds_transactionFinancingChannelId_fkey" FOREIGN KEY ("transactionFinancingChannelId") REFERENCES public.transaction_financing_channels(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: transaction_bonds transaction_bonds_transactionFinancingTypeId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transaction_bonds
    ADD CONSTRAINT "transaction_bonds_transactionFinancingTypeId_fkey" FOREIGN KEY ("transactionFinancingTypeId") REFERENCES public.transaction_financing_types(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: transaction_bonds transaction_bonds_transactionId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transaction_bonds
    ADD CONSTRAINT "transaction_bonds_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES public.transactions(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: transaction_bonds transaction_bonds_transferAttorneyId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transaction_bonds
    ADD CONSTRAINT "transaction_bonds_transferAttorneyId_fkey" FOREIGN KEY ("transferAttorneyId") REFERENCES public.contacts(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: transaction_contacts transaction_contacts_contactId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transaction_contacts
    ADD CONSTRAINT "transaction_contacts_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES public.contacts(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: transaction_contacts transaction_contacts_transactionContactTypeId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transaction_contacts
    ADD CONSTRAINT "transaction_contacts_transactionContactTypeId_fkey" FOREIGN KEY ("transactionContactTypeId") REFERENCES public.transaction_contact_types(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: transaction_contacts transaction_contacts_transactionId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transaction_contacts
    ADD CONSTRAINT "transaction_contacts_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES public.transactions(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: transaction_descriptions transaction_descriptions_transactionId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transaction_descriptions
    ADD CONSTRAINT "transaction_descriptions_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES public.transactions(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: transaction_documents transaction_documents_documentId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transaction_documents
    ADD CONSTRAINT "transaction_documents_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES public.documents(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: transaction_documents transaction_documents_transactionId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transaction_documents
    ADD CONSTRAINT "transaction_documents_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES public.transactions(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: transaction_notes transaction_notes_transactionId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transaction_notes
    ADD CONSTRAINT "transaction_notes_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES public.transactions(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: transactions transactions_listingId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT "transactions_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES public.listings(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: transactions transactions_statusId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT "transactions_statusId_fkey" FOREIGN KEY ("statusId") REFERENCES public.transaction_statuses(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: user_roles user_roles_roleId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT "user_roles_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES public.roles(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: user_roles user_roles_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT "user_roles_userId_fkey" FOREIGN KEY ("userId") REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict E1owFvhhGgXPmWaeI0Lv1cd362sfC3SkmBPg5I8wxj39XrdY57Ng87mG6copcV8

