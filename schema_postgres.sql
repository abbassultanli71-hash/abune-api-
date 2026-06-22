-- PostgreSQL Database Schema for Subscription Management Platform

-- Drop tables if they exist
DROP TABLE IF EXISTS istifadeci_ayarlari CASCADE;
DROP TABLE IF EXISTS budceler CASCADE;
DROP TABLE IF EXISTS abunelik_ortaqlar CASCADE;
DROP TABLE IF EXISTS odenis_tarixcesi CASCADE;
DROP TABLE IF EXISTS bildirisler CASCADE;
DROP TABLE IF EXISTS abunelikler CASCADE;
DROP TABLE IF EXISTS odenis_metodlari CASCADE;
DROP TABLE IF EXISTS xidmet_paketleri CASCADE;
DROP TABLE IF EXISTS abunelik_xidmetleri CASCADE;
DROP TABLE IF EXISTS istifadeciler CASCADE;

-- 1. ISTIFADECILER (Users) Table
CREATE TABLE istifadeciler (
    id SERIAL PRIMARY KEY,
    ad VARCHAR(100) NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    yaradilma_tarixi TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. ABUNELIK_XIDMETLERI Table
CREATE TABLE abunelik_xidmetleri (
    id SERIAL PRIMARY KEY,
    ad VARCHAR(100) UNIQUE NOT NULL,
    logo_url VARCHAR(500),
    vebsayt VARCHAR(200),
    kateqoriya VARCHAR(50)
);

-- 3. XIDMET_PAKETLERI Table
CREATE TABLE xidmet_paketleri (
    id SERIAL PRIMARY KEY,
    xidmet_id INTEGER NOT NULL REFERENCES abunelik_xidmetleri(id) ON DELETE CASCADE,
    paket_adi VARCHAR(100) NOT NULL,
    qiymet NUMERIC(10, 2) NOT NULL,
    valyuta VARCHAR(10) DEFAULT 'AZN',
    tezlik VARCHAR(20) DEFAULT 'monthly'
);

-- 4. ODENIS_METODLARI Table
CREATE TABLE odenis_metodlari (
    id SERIAL PRIMARY KEY,
    istifadeci_id INTEGER NOT NULL REFERENCES istifadeciler(id) ON DELETE CASCADE,
    ad VARCHAR(100) NOT NULL,
    kart_tipi VARCHAR(50) NOT NULL,
    son_dord_reqem VARCHAR(4),
    kart_istifade_tarixi VARCHAR(10),
    status VARCHAR(20) DEFAULT 'active'
);

-- 5. ABUNELIKLER (Subscriptions) Table
CREATE TABLE abunelikler (
    id SERIAL PRIMARY KEY,
    istifadeci_id INTEGER NOT NULL REFERENCES istifadeciler(id) ON DELETE CASCADE,
    ad VARCHAR(100) NOT NULL,
    qiymet NUMERIC(10, 2) NOT NULL,
    valyuta VARCHAR(10) DEFAULT 'AZN',
    odenis_tezliyi VARCHAR(20) DEFAULT 'monthly',
    baslama_tarixi DATE NOT NULL,
    novbeti_odenis_tarixi DATE NOT NULL,
    kateqoriya VARCHAR(50),
    status VARCHAR(20) DEFAULT 'active',
    odenis_metodu_id INTEGER REFERENCES odenis_metodlari(id) ON DELETE SET NULL,
    yaradilma_tarixi TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 6. BILDIRISLER (Notifications) Table
CREATE TABLE bildirisler (
    id SERIAL PRIMARY KEY,
    istifadeci_id INTEGER NOT NULL REFERENCES istifadeciler(id) ON DELETE CASCADE,
    basliq VARCHAR(200) NOT NULL,
    mesaj VARCHAR(1000) NOT NULL,
    gonderilme_tarixi DATE DEFAULT CURRENT_DATE,
    oxunub SMALLINT DEFAULT 0
);

-- 7. ODENIS_TARIXCESI (Payment History) Table
CREATE TABLE odenis_tarixcesi (
    id SERIAL PRIMARY KEY,
    abunelik_id INTEGER NOT NULL REFERENCES abunelikler(id) ON DELETE CASCADE,
    istifadeci_id INTEGER NOT NULL REFERENCES istifadeciler(id) ON DELETE CASCADE,
    odenis_tarixi DATE NOT NULL,
    mebleq NUMERIC(10, 2) NOT NULL,
    status VARCHAR(20) DEFAULT 'success'
);

-- 8. ABUNELIK_ORTAQLAR Table
CREATE TABLE abunelik_ortaqlar (
    id SERIAL PRIMARY KEY,
    abunelik_id INTEGER NOT NULL REFERENCES abunelikler(id) ON DELETE CASCADE,
    istifadeci_id INTEGER NOT NULL REFERENCES istifadeciler(id) ON DELETE CASCADE,
    ortaq_istifadeci_id INTEGER NOT NULL REFERENCES istifadeciler(id) ON DELETE CASCADE,
    pay_faizi NUMERIC(5, 2) DEFAULT 50.00,
    status VARCHAR(20) DEFAULT 'pending'
);

-- 9. BUDCELER Table
CREATE TABLE budceler (
    id SERIAL PRIMARY KEY,
    istifadeci_id INTEGER NOT NULL REFERENCES istifadeciler(id) ON DELETE CASCADE,
    limit_mebleq NUMERIC(10, 2) NOT NULL,
    valyuta VARCHAR(10) DEFAULT 'AZN',
    bildiris_faizi NUMERIC(5, 2) DEFAULT 90.00
);

-- 10. ISTIFADECI_AYARLARI Table
CREATE TABLE istifadeci_ayarlari (
    id SERIAL PRIMARY KEY,
    istifadeci_id INTEGER UNIQUE NOT NULL REFERENCES istifadeciler(id) ON DELETE CASCADE,
    esas_valyuta VARCHAR(10) DEFAULT 'AZN',
    bildiris_metodu VARCHAR(50) DEFAULT 'email',
    dil VARCHAR(5) DEFAULT 'az',
    tema VARCHAR(10) DEFAULT 'dark'
);

-- Test Seed Data
INSERT INTO istifadeciler (ad, email) VALUES ('Abbas Abbasov', 'abbas@example.com');
INSERT INTO istifadeciler (ad, email) VALUES ('Elnur Mammadov', 'elnur@example.com');

INSERT INTO abunelikler (istifadeci_id, ad, qiymet, valyuta, odenis_tezliyi, baslama_tarixi, novbeti_odenis_tarixi, kateqoriya, status)
VALUES (1, 'Netflix', 12.99, 'USD', 'monthly', '2026-01-01', '2026-07-01', 'Entertainment', 'active');

INSERT INTO abunelikler (istifadeci_id, ad, qiymet, valyuta, odenis_tezliyi, baslama_tarixi, novbeti_odenis_tarixi, kateqoriya, status)
VALUES (2, 'Spotify', 4.99, 'USD', 'monthly', '2026-02-15', '2026-08-15', 'Music', 'active');

INSERT INTO bildirisler (istifadeci_id, basliq, mesaj)
VALUES (1, 'Yaxınlaşan Ödəniş', 'Netflix abunəliyiniz növbəti ay üçün yenilənəcək.');

INSERT INTO odenis_tarixcesi (abunelik_id, istifadeci_id, odenis_tarixi, mebleq, status)
VALUES (1, 1, '2026-01-01', 12.99, 'success');
