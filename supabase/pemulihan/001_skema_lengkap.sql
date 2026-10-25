-- Pemulihan skema Supabase SIGAP (schema 'sigap'), dibuat 25 Okt 2026 dari database live.
-- Urutan: schema -> norm_kelas -> tabel -> RLS -> fungsi/trigger/indeks. Tanpa data, tanpa rahasia.
-- Tidak termasuk: edge function (lihat functions/), isi Vault, ekstensi pg_cron/pg_net (aktifkan di Supabase),
-- dan penjadwalan cron (baris terakhir, dikomentari).
create schema if not exists sigap;

CREATE OR REPLACE FUNCTION sigap.norm_kelas(k text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select lower(
    regexp_replace(
      btrim(
        regexp_replace(
          regexp_replace(coalesce(k, ''), '\([^)]*\)', '', 'g'),
          '[.\-]', ' ', 'g'
        )
      ),
      '\s+', ' ', 'g'
    )
  );
$function$;

CREATE TABLE sigap.guru (
  id text NOT NULL, nama text NOT NULL, password_hash text NOT NULL, salt text,
  role text NOT NULL, jabatan text DEFAULT ''::text NOT NULL, status text DEFAULT 'aktif'::text NOT NULL,
  kelas_wali text DEFAULT ''::text NOT NULL, created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL, password_changed_at timestamptz,
  CONSTRAINT guru_pkey PRIMARY KEY (id),
  CONSTRAINT guru_role_check CHECK (((role = lower(btrim(role))) AND (role <> ''::text))),
  CONSTRAINT guru_status_check CHECK ((status = ANY (ARRAY['aktif'::text, 'nonaktif'::text])))
);
CREATE TABLE sigap.siswa (
  id uuid DEFAULT gen_random_uuid() NOT NULL, nisn text NOT NULL, nama text NOT NULL, kelas text NOT NULL,
  kelas_norm text GENERATED ALWAYS AS (sigap.norm_kelas(kelas)) STORED,
  status text DEFAULT 'aktif'::text NOT NULL, ditambah_oleh text, waktu_tambah timestamptz, nisn_lama text,
  created_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT siswa_pkey PRIMARY KEY (id),
  CONSTRAINT siswa_nisn_key UNIQUE (nisn),
  CONSTRAINT siswa_status_check CHECK ((status = ANY (ARRAY['aktif'::text, 'perlu_verifikasi'::text])))
);
CREATE TABLE sigap.izin_kelompok (
  id uuid DEFAULT gen_random_uuid() NOT NULL, dicatat_pada timestamptz DEFAULT now() NOT NULL,
  kegiatan text NOT NULL, tujuan text NOT NULL, keperluan text DEFAULT ''::text NOT NULL,
  pola_kembali text DEFAULT ''::text NOT NULL, jumlah_peserta integer DEFAULT 0 NOT NULL,
  jalur text DEFAULT 'normal'::text NOT NULL, alasan_khusus text DEFAULT ''::text NOT NULL,
  disetujui_oleh text DEFAULT ''::text NOT NULL, disetujui_oleh_id text, waktu_persetujuan timestamptz,
  diverifikasi_oleh text DEFAULT ''::text NOT NULL, diverifikasi_oleh_id text, waktu_verifikasi timestamptz,
  CONSTRAINT izin_kelompok_pkey PRIMARY KEY (id),
  CONSTRAINT izin_kelompok_jalur_check CHECK ((jalur = ANY (ARRAY['normal'::text, 'khusus'::text]))),
  CONSTRAINT izin_kelompok_pola_kembali_check CHECK ((pola_kembali = ANY (ARRAY[''::text, 'bersama'::text, 'individual'::text]))),
  CONSTRAINT izin_kelompok_tujuan_check CHECK ((tujuan = ANY (ARRAY['kembali'::text, 'pulang'::text])))
);
CREATE TABLE sigap.audit_log (
  id bigint GENERATED ALWAYS AS IDENTITY, waktu timestamptz DEFAULT now() NOT NULL, nama text NOT NULL,
  guru_id text, aksi text NOT NULL, detail text DEFAULT ''::text NOT NULL,
  CONSTRAINT audit_log_pkey PRIMARY KEY (id)
);
CREATE TABLE sigap.error_log (
  id bigint GENERATED ALWAYS AS IDENTITY, waktu timestamptz DEFAULT now() NOT NULL,
  nama text DEFAULT ''::text NOT NULL, guru_id text, pesan text DEFAULT ''::text NOT NULL,
  detail text DEFAULT ''::text NOT NULL, halaman text DEFAULT ''::text NOT NULL,
  CONSTRAINT error_log_pkey PRIMARY KEY (id)
);
CREATE TABLE sigap.login_gagal (
  kunci text NOT NULL, jendela bigint NOT NULL, jumlah integer DEFAULT 0 NOT NULL,
  CONSTRAINT login_gagal_pkey PRIMARY KEY (kunci, jendela)
);
CREATE TABLE sigap.sesi (
  token_hash text NOT NULL, guru_id text NOT NULL, login_at timestamptz DEFAULT now() NOT NULL,
  expires_at timestamptz NOT NULL,
  CONSTRAINT sesi_pkey PRIMARY KEY (token_hash),
  CONSTRAINT sesi_guru_id_fkey FOREIGN KEY (guru_id) REFERENCES sigap.guru(id) ON UPDATE CASCADE ON DELETE CASCADE
);
CREATE TABLE sigap.jadwal_piket (
  hari text NOT NULL, guru_id text NOT NULL,
  CONSTRAINT jadwal_piket_pkey PRIMARY KEY (hari, guru_id),
  CONSTRAINT jadwal_piket_hari_check CHECK ((hari = ANY (ARRAY['Minggu'::text, 'Senin'::text, 'Selasa'::text, 'Rabu'::text, 'Kamis'::text, 'Jumat'::text, 'Sabtu'::text]))),
  CONSTRAINT jadwal_piket_guru_id_fkey FOREIGN KEY (guru_id) REFERENCES sigap.guru(id) ON UPDATE CASCADE
);
CREATE TABLE sigap.terlambat (
  id uuid DEFAULT gen_random_uuid() NOT NULL, dicatat_pada timestamptz DEFAULT now() NOT NULL,
  tanggal date GENERATED ALWAYS AS (((dicatat_pada AT TIME ZONE 'Asia/Makassar'::text))::date) STORED,
  siswa_id uuid, nisn text NOT NULL, nama text NOT NULL, kelas text DEFAULT ''::text NOT NULL,
  kelas_norm text GENERATED ALWAYS AS (sigap.norm_kelas(kelas)) STORED,
  alasan text DEFAULT ''::text NOT NULL, dicatat_oleh text NOT NULL, dicatat_oleh_id text,
  CONSTRAINT terlambat_pkey PRIMARY KEY (id),
  CONSTRAINT terlambat_sekali_per_hari UNIQUE (nisn, tanggal),
  CONSTRAINT terlambat_dicatat_oleh_id_fkey FOREIGN KEY (dicatat_oleh_id) REFERENCES sigap.guru(id) ON DELETE SET NULL,
  CONSTRAINT terlambat_siswa_id_fkey FOREIGN KEY (siswa_id) REFERENCES sigap.siswa(id) ON DELETE SET NULL
);
CREATE TABLE sigap.surat_masuk (
  id uuid DEFAULT gen_random_uuid() NOT NULL, dicatat_pada timestamptz DEFAULT now() NOT NULL,
  tanggal date GENERATED ALWAYS AS (((dicatat_pada AT TIME ZONE 'Asia/Makassar'::text))::date) STORED,
  siswa_id uuid, nisn text NOT NULL, nama text NOT NULL, kelas text DEFAULT ''::text NOT NULL,
  kelas_norm text GENERATED ALWAYS AS (sigap.norm_kelas(kelas)) STORED,
  jenis text NOT NULL, keterangan text DEFAULT ''::text NOT NULL, foto_url text,
  dicatat_oleh text NOT NULL, dicatat_oleh_id text,
  CONSTRAINT surat_masuk_pkey1 PRIMARY KEY (id),
  CONSTRAINT surat_sekali_per_hari UNIQUE (nisn, tanggal),
  CONSTRAINT surat_masuk_dicatat_oleh_id_fkey1 FOREIGN KEY (dicatat_oleh_id) REFERENCES sigap.guru(id) ON DELETE SET NULL,
  CONSTRAINT surat_masuk_siswa_id_fkey1 FOREIGN KEY (siswa_id) REFERENCES sigap.siswa(id) ON DELETE SET NULL
);
CREATE TABLE sigap.surat_masuk_tahap1_kosong (
  id uuid DEFAULT gen_random_uuid() NOT NULL, dicatat_pada timestamptz DEFAULT now() NOT NULL,
  tanggal date GENERATED ALWAYS AS (((dicatat_pada AT TIME ZONE 'Asia/Makassar'::text))::date) STORED,
  siswa_id uuid NOT NULL, nama text NOT NULL, kelas text NOT NULL, jenis text NOT NULL,
  keterangan text DEFAULT ''::text NOT NULL, foto_url text, dicatat_oleh text NOT NULL, dicatat_oleh_id text,
  CONSTRAINT surat_masuk_pkey PRIMARY KEY (id),
  CONSTRAINT surat_masuk_sekali_per_hari UNIQUE (siswa_id, tanggal),
  CONSTRAINT surat_masuk_dicatat_oleh_id_fkey FOREIGN KEY (dicatat_oleh_id) REFERENCES sigap.guru(id) ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT surat_masuk_siswa_id_fkey FOREIGN KEY (siswa_id) REFERENCES sigap.siswa(id) ON UPDATE CASCADE
);
CREATE TABLE sigap.pelanggaran (
  id uuid DEFAULT gen_random_uuid() NOT NULL, dicatat_pada timestamptz DEFAULT now() NOT NULL,
  tanggal date GENERATED ALWAYS AS (((dicatat_pada AT TIME ZONE 'Asia/Makassar'::text))::date) STORED,
  siswa_id uuid, nisn text NOT NULL, nama text NOT NULL, kelas text DEFAULT ''::text NOT NULL,
  kelas_norm text GENERATED ALWAYS AS (sigap.norm_kelas(kelas)) STORED,
  jenis_pelanggaran text NOT NULL, sanksi text DEFAULT ''::text NOT NULL, catatan text DEFAULT ''::text NOT NULL,
  dicatat_oleh text NOT NULL, dicatat_oleh_id text,
  CONSTRAINT pelanggaran_pkey PRIMARY KEY (id),
  CONSTRAINT pelanggaran_dicatat_oleh_id_fkey FOREIGN KEY (dicatat_oleh_id) REFERENCES sigap.guru(id) ON DELETE SET NULL,
  CONSTRAINT pelanggaran_siswa_id_fkey FOREIGN KEY (siswa_id) REFERENCES sigap.siswa(id) ON DELETE SET NULL
);
CREATE TABLE sigap.pelanggaran_upacara (
  id uuid DEFAULT gen_random_uuid() NOT NULL, dicatat_pada timestamptz DEFAULT now() NOT NULL,
  tanggal date GENERATED ALWAYS AS (((dicatat_pada AT TIME ZONE 'Asia/Makassar'::text))::date) STORED,
  siswa_id uuid, nisn text NOT NULL, nama text NOT NULL, kelas text DEFAULT ''::text NOT NULL,
  kelas_norm text GENERATED ALWAYS AS (sigap.norm_kelas(kelas)) STORED,
  jenis_pelanggaran text NOT NULL, catatan text DEFAULT ''::text NOT NULL, dicatat_oleh text NOT NULL, dicatat_oleh_id text,
  CONSTRAINT pelanggaran_upacara_pkey PRIMARY KEY (id),
  CONSTRAINT upacara_sekali_per_jenis_hari UNIQUE (nisn, jenis_pelanggaran, tanggal),
  CONSTRAINT pelanggaran_upacara_dicatat_oleh_id_fkey FOREIGN KEY (dicatat_oleh_id) REFERENCES sigap.guru(id) ON DELETE SET NULL,
  CONSTRAINT pelanggaran_upacara_siswa_id_fkey FOREIGN KEY (siswa_id) REFERENCES sigap.siswa(id) ON DELETE SET NULL
);
CREATE TABLE sigap.bimbingan_khusus (
  id uuid DEFAULT gen_random_uuid() NOT NULL, dicatat_pada timestamptz DEFAULT now() NOT NULL,
  siswa_id uuid, nisn text NOT NULL, nama text NOT NULL, kelas text DEFAULT ''::text NOT NULL,
  catatan text NOT NULL, dicatat_oleh text NOT NULL, dicatat_oleh_id text,
  CONSTRAINT bimbingan_khusus_pkey PRIMARY KEY (id),
  CONSTRAINT bimbingan_khusus_dicatat_oleh_id_fkey FOREIGN KEY (dicatat_oleh_id) REFERENCES sigap.guru(id) ON DELETE SET NULL,
  CONSTRAINT bimbingan_khusus_siswa_id_fkey FOREIGN KEY (siswa_id) REFERENCES sigap.siswa(id) ON DELETE SET NULL
);
CREATE TABLE sigap.tindak_lanjut (
  id uuid DEFAULT gen_random_uuid() NOT NULL, dicatat_pada timestamptz DEFAULT now() NOT NULL,
  siswa_id uuid, nisn text NOT NULL, nama text NOT NULL, kelas text DEFAULT ''::text NOT NULL,
  kelas_norm text GENERATED ALWAYS AS (sigap.norm_kelas(kelas)) STORED,
  catatan text DEFAULT ''::text NOT NULL, diajukan_oleh text NOT NULL, diajukan_oleh_id text,
  status text DEFAULT 'menunggu'::text NOT NULL, disetujui_oleh text DEFAULT ''::text NOT NULL,
  disetujui_oleh_id text, disetujui_pada timestamptz,
  CONSTRAINT tindak_lanjut_pkey PRIMARY KEY (id),
  CONSTRAINT tindak_lanjut_status_check CHECK ((status = ANY (ARRAY['menunggu'::text, 'selesai'::text]))),
  CONSTRAINT tindak_lanjut_diajukan_oleh_id_fkey FOREIGN KEY (diajukan_oleh_id) REFERENCES sigap.guru(id) ON DELETE SET NULL,
  CONSTRAINT tindak_lanjut_disetujui_oleh_id_fkey FOREIGN KEY (disetujui_oleh_id) REFERENCES sigap.guru(id) ON DELETE SET NULL,
  CONSTRAINT tindak_lanjut_siswa_id_fkey FOREIGN KEY (siswa_id) REFERENCES sigap.siswa(id) ON DELETE SET NULL
);
CREATE TABLE sigap.izin_keluar (
  id uuid DEFAULT gen_random_uuid() NOT NULL, dicatat_pada timestamptz DEFAULT now() NOT NULL,
  siswa_id uuid, nisn text NOT NULL, nama text NOT NULL, kelas text DEFAULT ''::text NOT NULL,
  kelas_norm text GENERATED ALWAYS AS (sigap.norm_kelas(kelas)) STORED,
  keperluan text DEFAULT ''::text NOT NULL, tujuan text NOT NULL, status text NOT NULL,
  jalur text DEFAULT 'normal'::text NOT NULL, alasan_khusus text DEFAULT ''::text NOT NULL,
  disetujui_oleh text DEFAULT ''::text NOT NULL, disetujui_oleh_id text, waktu_persetujuan timestamptz,
  diverifikasi_oleh text DEFAULT ''::text NOT NULL, diverifikasi_oleh_id text, waktu_verifikasi timestamptz,
  waktu_keluar timestamptz, waktu_kembali timestamptz,
  dicatat_kembali_oleh text DEFAULT ''::text NOT NULL, dicatat_kembali_oleh_id text, kelompok_id uuid,
  nomor_surat text DEFAULT ''::text NOT NULL, waktu_print timestamptz,
  status_print text DEFAULT 'Belum'::text NOT NULL, jam_perkiraan_kembali text DEFAULT ''::text NOT NULL,
  CONSTRAINT izin_keluar_pkey PRIMARY KEY (id),
  CONSTRAINT izin_keluar_jalur_check CHECK ((jalur = ANY (ARRAY['normal'::text, 'khusus'::text]))),
  CONSTRAINT izin_keluar_jam_perkiraan_kembali_check CHECK (((jam_perkiraan_kembali = ''::text) OR (jam_perkiraan_kembali ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'::text))),
  CONSTRAINT izin_keluar_status_check CHECK ((status = ANY (ARRAY['Menunggu Verifikasi'::text, 'Sedang di Luar'::text, 'Selesai'::text, 'Pulang'::text, 'Kembali'::text]))),
  CONSTRAINT izin_keluar_status_print_check CHECK ((status_print = ANY (ARRAY['Belum'::text, 'Sudah'::text]))),
  CONSTRAINT izin_keluar_tujuan_check CHECK ((tujuan = ANY (ARRAY['kembali'::text, 'pulang'::text]))),
  CONSTRAINT izin_keluar_kelompok_fk FOREIGN KEY (kelompok_id) REFERENCES sigap.izin_kelompok(id),
  CONSTRAINT izin_keluar_siswa_id_fkey FOREIGN KEY (siswa_id) REFERENCES sigap.siswa(id)
);
CREATE TABLE sigap.push_subscription (
  id bigint GENERATED ALWAYS AS IDENTITY, endpoint text NOT NULL, guru_id text NOT NULL,
  p256dh text NOT NULL, auth text NOT NULL, user_agent text DEFAULT ''::text NOT NULL,
  diperbarui timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT push_subscription_pkey PRIMARY KEY (id),
  CONSTRAINT push_subscription_endpoint_key UNIQUE (endpoint),
  CONSTRAINT push_subscription_guru_id_fkey FOREIGN KEY (guru_id) REFERENCES sigap.guru(id) ON DELETE CASCADE
);
CREATE TABLE sigap.push_queue (
  id bigint GENERATED ALWAYS AS IDENTITY, dibuat timestamptz DEFAULT now() NOT NULL, event_id text NOT NULL,
  jenis text DEFAULT ''::text NOT NULL, nisn text DEFAULT ''::text NOT NULL, guru_id text NOT NULL,
  kind text NOT NULL, title text NOT NULL, body text NOT NULL, url text NOT NULL,
  prioritas text DEFAULT 'normal'::text NOT NULL, diproses boolean DEFAULT false NOT NULL,
  percobaan integer DEFAULT 0 NOT NULL, last_error text DEFAULT ''::text NOT NULL,
  claim_until timestamptz, selesai_pada timestamptz,
  CONSTRAINT push_queue_pkey PRIMARY KEY (id),
  CONSTRAINT push_queue_kind_check CHECK ((kind = ANY (ARRAY['wali_kelas'::text, 'guru_piket'::text]))),
  CONSTRAINT push_queue_guru_id_fkey FOREIGN KEY (guru_id) REFERENCES sigap.guru(id) ON DELETE CASCADE
);

-- RLS aktif tanpa policy: hanya koneksi server (edge function) yang bisa akses.
ALTER TABLE sigap.guru ENABLE ROW LEVEL SECURITY;
ALTER TABLE sigap.siswa ENABLE ROW LEVEL SECURITY;
ALTER TABLE sigap.izin_kelompok ENABLE ROW LEVEL SECURITY;
ALTER TABLE sigap.audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE sigap.error_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE sigap.login_gagal ENABLE ROW LEVEL SECURITY;
ALTER TABLE sigap.sesi ENABLE ROW LEVEL SECURITY;
ALTER TABLE sigap.jadwal_piket ENABLE ROW LEVEL SECURITY;
ALTER TABLE sigap.terlambat ENABLE ROW LEVEL SECURITY;
ALTER TABLE sigap.surat_masuk ENABLE ROW LEVEL SECURITY;
ALTER TABLE sigap.surat_masuk_tahap1_kosong ENABLE ROW LEVEL SECURITY;
ALTER TABLE sigap.pelanggaran ENABLE ROW LEVEL SECURITY;
ALTER TABLE sigap.pelanggaran_upacara ENABLE ROW LEVEL SECURITY;
ALTER TABLE sigap.bimbingan_khusus ENABLE ROW LEVEL SECURITY;
ALTER TABLE sigap.tindak_lanjut ENABLE ROW LEVEL SECURITY;
ALTER TABLE sigap.izin_keluar ENABLE ROW LEVEL SECURITY;
ALTER TABLE sigap.push_subscription ENABLE ROW LEVEL SECURITY;
ALTER TABLE sigap.push_queue ENABLE ROW LEVEL SECURITY;

-- Objek database schema `sigap` (proyek Supabase "Workflow", ref htutgpjcynbnyxwgorcb).
-- Disalin dari database live 25 Okt 2026: fungsi, trigger, indeks, dan jadwal cron.
-- BUKAN skrip pemulihan lengkap: definisi tabel ada di SCHEMA.md, dan riwayat migrasi asli
-- (nama "sigap_stage*", "push_*") ada di Supabase. Tidak berisi data atau rahasia.

-- ===== Fungsi =====
CREATE OR REPLACE FUNCTION sigap.beri_nomor_surat(p_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare v_no text; v_kode text; v_prefix text; v_max int;
begin
  perform pg_advisory_xact_lock(727001);
  select i.nomor_surat, to_char(i.waktu_verifikasi at time zone 'Asia/Makassar', 'YYYYMMDD')
    into v_no, v_kode from sigap.izin_keluar i where i.id = p_id;
  if not found then return null; end if;
  if v_no <> '' then return v_no; end if;
  if v_kode is null then v_kode := to_char(now() at time zone 'Asia/Makassar', 'YYYYMMDD'); end if;
  v_prefix := 'IK-' || v_kode || '-';
  select coalesce(max(substring(nomor_surat from length(v_prefix) + 1)::int), 0) into v_max
    from sigap.izin_keluar
    where nomor_surat like v_prefix || '%' and substring(nomor_surat from length(v_prefix) + 1) ~ '^[0-9]+$';
  v_no := v_prefix || case when v_max + 1 < 1000 then lpad((v_max + 1)::text, 3, '0') else (v_max + 1)::text end;
  update sigap.izin_keluar set nomor_surat = v_no where id = p_id;
  return v_no;
end $function$;

CREATE OR REPLACE FUNCTION sigap.push_salinan(p_jenis text, p_kind text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select case
    when p_kind = 'guru_piket' then 'Izin siswa menunggu verifikasi. Buka SIGAP untuk memproses.'
    else case p_jenis
      when 'keterlambatan'     then 'Ada siswa di kelas Anda tercatat terlambat hari ini.'
      when 'surat'             then 'Ada catatan surat baru untuk siswa di kelas Anda.'
      when 'izin_dibuat'       then 'Izin keluar diajukan untuk siswa di kelas Anda.'
      when 'izin_diverifikasi' then 'Status izin keluar siswa di kelas Anda telah diperbarui.'
      when 'izin_kembali'      then 'Siswa di kelas Anda tercatat sudah kembali ke sekolah.'
      when 'izin_pulang'       then 'Siswa di kelas Anda tercatat pulang melalui jalur izin.'
      else 'Terdapat kejadian baru terkait salah satu siswa di kelas Anda.'
    end
  end;
$function$;

CREATE OR REPLACE FUNCTION sigap.push_enqueue(p_jenis text, p_nisn text, p_kelas text, p_ref_id text, p_perlu_piket boolean DEFAULT false, p_waktu timestamp with time zone DEFAULT now())
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare n int := 0; r record; eid text; ref text;
begin
  ref := coalesce(nullif(p_ref_id,''), p_nisn, '');
  for r in
    select g.id as guru_id, 'wali_kelas'::text as kind
      from sigap.guru g
     where g.status <> 'nonaktif' and g.kelas_wali <> ''
       and sigap.norm_kelas(p_kelas) <> ''
       and sigap.norm_kelas(g.kelas_wali) = sigap.norm_kelas(p_kelas)
    union
    select g.id, 'guru_piket'
      from sigap.jadwal_piket j join sigap.guru g on g.id = j.guru_id
     where p_perlu_piket and g.status <> 'nonaktif'
       and j.hari = (array['Minggu','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'])
                    [extract(dow from (p_waktu at time zone 'Asia/Makassar'))::int + 1]
  loop
    eid := p_jenis || '|' || ref || '|' || r.guru_id || '|' || r.kind;
    perform pg_advisory_xact_lock(hashtext(eid));
    if not exists (select 1 from sigap.push_queue q
                    where q.event_id = eid and q.dibuat > now() - interval '2 minutes') then
      insert into sigap.push_queue (event_id, jenis, nisn, guru_id, kind, title, body, url)
      values (eid, p_jenis, coalesce(p_nisn,''), r.guru_id, r.kind, 'SIGAP',
              sigap.push_salinan(p_jenis, r.kind),
              case r.kind when 'guru_piket' then 'izin' else 'log' end);
      n := n + 1;
    end if;
  end loop;
  return n;
exception when others then
  return 0;
end $function$;

CREATE OR REPLACE FUNCTION sigap.picu_push_send()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if exists (select 1 from sigap.push_queue where not diproses and (claim_until is null or claim_until < now())) then
    perform net.http_post(
      url := 'https://htutgpjcynbnyxwgorcb.supabase.co/functions/v1/push-send',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'push_internal_secret')),
      body := '{}'::jsonb,
      timeout_milliseconds := 30000);
  end if;
end $function$;

CREATE OR REPLACE FUNCTION sigap.trg_push_catat()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare r record;
begin
  if coalesce(current_setting('sigap.skip_push', true), '') = '1' then return null; end if;
  for r in
    select min(kelas) as kelas, min(nisn) as nisn
      from nw
     where dicatat_pada > now() - interval '5 minutes'
     group by sigap.norm_kelas(kelas)
  loop
    perform sigap.push_enqueue(tg_argv[0], r.nisn, r.kelas, r.nisn, false, now());
  end loop;
  return null;
exception when others then
  return null;
end $function$;

CREATE OR REPLACE FUNCTION sigap.trg_push_izin_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare r record;
begin
  if coalesce(current_setting('sigap.skip_push', true), '') = '1' then return null; end if;
  for r in
    select distinct on (sigap.norm_kelas(kelas), coalesce(kelompok_id, id))
           kelas, nisn, coalesce(kelompok_id, id)::text as ref, jalur
      from nw
     where dicatat_pada > now() - interval '5 minutes'
  loop
    perform sigap.push_enqueue(case when r.jalur = 'khusus' then 'izin_diverifikasi' else 'izin_dibuat' end,
                               r.nisn, r.kelas, r.ref, false, now());
  end loop;
  -- Guru piket: sekali per izin/kegiatan, hanya jalur normal (ada verifikasi yang menunggu).
  for r in
    select distinct coalesce(kelompok_id, id)::text as ref
      from nw
     where jalur = 'normal' and status = 'Menunggu Verifikasi' and dicatat_pada > now() - interval '5 minutes'
  loop
    perform sigap.push_enqueue('izin_dibuat', '', '', r.ref, true, now());
  end loop;
  return null;
exception when others then
  return null;
end $function$;

CREATE OR REPLACE FUNCTION sigap.trg_push_izin_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare r record;
begin
  if coalesce(current_setting('sigap.skip_push', true), '') = '1' then return null; end if;
  for r in
    select distinct on (sigap.norm_kelas(x.kelas), x.ref, x.jenis) x.kelas, x.nisn, x.ref, x.jenis
      from (
        select n.kelas, n.nisn, coalesce(n.kelompok_id, n.id)::text as ref,
               case
                 when o.status = 'Menunggu Verifikasi' and n.status in ('Sedang di Luar','Pulang') then 'izin_diverifikasi'
                 when o.status = 'Sedang di Luar' and n.status = 'Selesai' then 'izin_kembali'
                 when o.status = 'Sedang di Luar' and n.status = 'Pulang' then 'izin_pulang'
               end as jenis
          from od o join nw n on n.id = o.id
         where o.status is distinct from n.status
      ) x
     where x.jenis is not null
  loop
    perform sigap.push_enqueue(r.jenis, r.nisn, r.kelas, r.ref, false, now());
  end loop;
  return null;
exception when others then
  return null;
end $function$;

-- ===== Trigger =====
CREATE TRIGGER push_izin_insert AFTER INSERT ON sigap.izin_keluar REFERENCING NEW TABLE AS nw FOR EACH STATEMENT EXECUTE FUNCTION sigap.trg_push_izin_insert();
CREATE TRIGGER push_izin_update AFTER UPDATE ON sigap.izin_keluar REFERENCING OLD TABLE AS od NEW TABLE AS nw FOR EACH STATEMENT EXECUTE FUNCTION sigap.trg_push_izin_update();
CREATE TRIGGER push_pelanggaran AFTER INSERT ON sigap.pelanggaran REFERENCING NEW TABLE AS nw FOR EACH STATEMENT EXECUTE FUNCTION sigap.trg_push_catat('pelanggaran');
CREATE TRIGGER push_upacara AFTER INSERT ON sigap.pelanggaran_upacara REFERENCING NEW TABLE AS nw FOR EACH STATEMENT EXECUTE FUNCTION sigap.trg_push_catat('pelanggaran_upacara');
CREATE TRIGGER push_surat AFTER INSERT ON sigap.surat_masuk REFERENCING NEW TABLE AS nw FOR EACH STATEMENT EXECUTE FUNCTION sigap.trg_push_catat('surat');
CREATE TRIGGER push_terlambat AFTER INSERT ON sigap.terlambat REFERENCING NEW TABLE AS nw FOR EACH STATEMENT EXECUTE FUNCTION sigap.trg_push_catat('keterlambatan');

-- ===== Indeks (selain primary key) =====
CREATE INDEX audit_log_waktu_idx ON sigap.audit_log USING btree (waktu DESC);
CREATE INDEX bimbingan_waktu_idx ON sigap.bimbingan_khusus USING btree (dicatat_pada DESC);
CREATE INDEX error_log_waktu_idx ON sigap.error_log USING btree (waktu DESC);
CREATE INDEX izin_keluar_dicatat_idx ON sigap.izin_keluar USING btree (dicatat_pada DESC);
CREATE INDEX izin_keluar_kelas_idx ON sigap.izin_keluar USING btree (kelas_norm);
CREATE INDEX izin_keluar_kelompok_idx ON sigap.izin_keluar USING btree (kelompok_id) WHERE (kelompok_id IS NOT NULL);
CREATE UNIQUE INDEX izin_nomor_surat_unik ON sigap.izin_keluar USING btree (nomor_surat) WHERE (nomor_surat <> ''::text);
CREATE UNIQUE INDEX izin_satu_terbuka_per_siswa ON sigap.izin_keluar USING btree (nisn) WHERE (status = ANY (ARRAY['Menunggu Verifikasi'::text, 'Sedang di Luar'::text]));
CREATE INDEX pelanggaran_kelas_idx ON sigap.pelanggaran USING btree (kelas_norm);
CREATE INDEX pelanggaran_nisn_idx ON sigap.pelanggaran USING btree (nisn);
CREATE INDEX pelanggaran_oleh_idx ON sigap.pelanggaran USING btree (dicatat_oleh_id);
CREATE INDEX pelanggaran_waktu_idx ON sigap.pelanggaran USING btree (dicatat_pada DESC);
CREATE INDEX upacara_kelas_idx ON sigap.pelanggaran_upacara USING btree (kelas_norm);
CREATE INDEX upacara_waktu_idx ON sigap.pelanggaran_upacara USING btree (dicatat_pada DESC);
CREATE INDEX push_queue_antri_idx ON sigap.push_queue USING btree (id) WHERE (NOT diproses);
CREATE INDEX push_queue_event_idx ON sigap.push_queue USING btree (event_id, dibuat DESC);
CREATE INDEX push_subscription_guru_idx ON sigap.push_subscription USING btree (guru_id);
CREATE INDEX sesi_expires_idx ON sigap.sesi USING btree (expires_at);
CREATE INDEX sesi_guru_idx ON sigap.sesi USING btree (guru_id);
CREATE INDEX siswa_kelas_norm_idx ON sigap.siswa USING btree (kelas_norm);
CREATE INDEX surat_kls_idx ON sigap.surat_masuk USING btree (kelas_norm);
CREATE INDEX surat_tgl_idx ON sigap.surat_masuk USING btree (tanggal DESC, dicatat_pada DESC);
CREATE INDEX surat_masuk_tanggal_idx ON sigap.surat_masuk_tahap1_kosong USING btree (tanggal);
CREATE INDEX terlambat_kelas_idx ON sigap.terlambat USING btree (kelas_norm);
CREATE INDEX terlambat_tanggal_idx ON sigap.terlambat USING btree (tanggal DESC, dicatat_pada DESC);
CREATE INDEX tindaklanjut_kelas_idx ON sigap.tindak_lanjut USING btree (kelas_norm);
CREATE INDEX tindaklanjut_waktu_idx ON sigap.tindak_lanjut USING btree (dicatat_pada DESC);

-- ===== Cron (pg_cron) =====
-- select cron.schedule('sigap-push-send', '* * * * *', 'select sigap.picu_push_send()');
