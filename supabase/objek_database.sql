-- Objek database schema `sigap` (proyek Supabase "Workflow", ref htutgpjcynbnyxwgorcb).
-- Disalin dari database live 25 Okt 2026: fungsi, trigger, indeks, dan jadwal cron.
-- BUKAN skrip pemulihan lengkap: definisi tabel ada di SCHEMA.md, dan riwayat migrasi asli
-- (nama "sigap_stage*", "push_*") ada di Supabase. Tidak berisi data atau rahasia.

-- ===== Fungsi =====
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
CREATE UNIQUE INDEX upacara_sekali_per_jenis_hari ON sigap.pelanggaran_upacara USING btree (nisn, jenis_pelanggaran, tanggal);
CREATE INDEX upacara_waktu_idx ON sigap.pelanggaran_upacara USING btree (dicatat_pada DESC);
CREATE INDEX push_queue_antri_idx ON sigap.push_queue USING btree (id) WHERE (NOT diproses);
CREATE INDEX push_queue_event_idx ON sigap.push_queue USING btree (event_id, dibuat DESC);
CREATE UNIQUE INDEX push_subscription_endpoint_key ON sigap.push_subscription USING btree (endpoint);
CREATE INDEX push_subscription_guru_idx ON sigap.push_subscription USING btree (guru_id);
CREATE INDEX sesi_expires_idx ON sigap.sesi USING btree (expires_at);
CREATE INDEX sesi_guru_idx ON sigap.sesi USING btree (guru_id);
CREATE INDEX siswa_kelas_norm_idx ON sigap.siswa USING btree (kelas_norm);
CREATE UNIQUE INDEX siswa_nisn_key ON sigap.siswa USING btree (nisn);
CREATE INDEX surat_kls_idx ON sigap.surat_masuk USING btree (kelas_norm);
CREATE UNIQUE INDEX surat_sekali_per_hari ON sigap.surat_masuk USING btree (nisn, tanggal);
CREATE INDEX surat_tgl_idx ON sigap.surat_masuk USING btree (tanggal DESC, dicatat_pada DESC);
CREATE UNIQUE INDEX surat_masuk_sekali_per_hari ON sigap.surat_masuk_tahap1_kosong USING btree (siswa_id, tanggal);
CREATE INDEX surat_masuk_tanggal_idx ON sigap.surat_masuk_tahap1_kosong USING btree (tanggal);
CREATE INDEX terlambat_kelas_idx ON sigap.terlambat USING btree (kelas_norm);
CREATE UNIQUE INDEX terlambat_sekali_per_hari ON sigap.terlambat USING btree (nisn, tanggal);
CREATE INDEX terlambat_tanggal_idx ON sigap.terlambat USING btree (tanggal DESC, dicatat_pada DESC);
CREATE INDEX tindaklanjut_kelas_idx ON sigap.tindak_lanjut USING btree (kelas_norm);
CREATE INDEX tindaklanjut_waktu_idx ON sigap.tindak_lanjut USING btree (dicatat_pada DESC);

-- ===== Cron (pg_cron) =====
-- select cron.schedule('sigap-push-send', '* * * * *', 'select sigap.picu_push_send()');
