// ===== export-format.js =====
// Pembuat berkas laporan: PDF (siap cetak) & Excel .xlsx (siap diolah lagi).
// MURNI — tanpa React, tanpa state, tanpa panggilan jaringan: masukannya
// objek `report` yang SUDAH jadi dari server (lihat aksi 'exportData' di
// Code.gs), keluarannya deretan byte. Karena itu bisa diuji langsung di
// tests/export-format.test.js tanpa browser.
//
// Kenapa ditulis sendiri, bukan pakai jsPDF/SheetJS dari CDN:
// SIGAP tidak punya build step (lihat index.html) dan dibuka dari HP guru
// lewat koneksi sekolah — menambah ~1 MB pustaka hanya untuk dua tombol
// export akan terasa di SETIAP pembukaan aplikasi, bukan cuma saat export.
// Yang dibutuhkan di sini kecil dan tetap: satu tabel, dua font standar PDF
// (Helvetica/Helvetica-Bold, tidak perlu di-embed), dan satu sheet XLSX.
//
// PENTING: file ini TIDAK memutuskan apa pun soal hak akses. Isi laporan
// sepenuhnya ditentukan server (baris & kolom yang boleh dilihat pemanggil);
// di sini tidak ada penyaringan, tidak ada pemilihan kolom, dan tidak ada
// field tambahan yang ditarik dari state aplikasi.

       // ===== Utilitas byte =====
       // TextEncoder sengaja tidak dipakai supaya fungsi-fungsi ini bisa
       // dijalankan di sandbox test (vm) yang tidak punya global browser.
       function utf8Bytes(str) {
           const s = String(str == null ? '' : str);
           const out = [];
           for (let i = 0; i < s.length; i++) {
               let cp = s.codePointAt(i);
               if (cp > 0xFFFF) i++; // surrogate pair sudah terbaca sekaligus
               if (cp < 0x80) out.push(cp);
               else if (cp < 0x800) out.push(0xC0 | (cp >> 6), 0x80 | (cp & 0x3F));
               else if (cp < 0x10000) out.push(0xE0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3F), 0x80 | (cp & 0x3F));
               else out.push(0xF0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3F), 0x80 | ((cp >> 6) & 0x3F), 0x80 | (cp & 0x3F));
           }
           return out;
       }

       // PDF ini memakai font standar dengan WinAnsiEncoding (1 byte per
       // karakter) — jadi teks di luar Latin-1 (mis. emoji yang sempat
       // terketik di kolom catatan) diganti '?' daripada merusak berkasnya.
       function latin1Bytes(str) {
           const s = String(str == null ? '' : str);
           const out = new Uint8Array(s.length);
           for (let i = 0; i < s.length; i++) {
               const c = s.charCodeAt(i);
               out[i] = c > 255 ? 63 : c;
           }
           return out;
       }

       const CRC32_TABLE = (() => {
           const table = new Array(256);
           for (let n = 0; n < 256; n++) {
               let c = n;
               for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
               table[n] = c >>> 0;
           }
           return table;
       })();

       function crc32(bytes) {
           let c = 0xFFFFFFFF;
           for (let i = 0; i < bytes.length; i++) c = CRC32_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
           return (c ^ 0xFFFFFFFF) >>> 0;
       }

       // ===== ZIP (metode "store", tanpa kompresi) =====
       // .xlsx itu sebuah ZIP. Entri disimpan apa adanya (tanpa deflate)
       // karena browser tidak punya kompresor sinkron yang bisa diandalkan di
       // semua HP yang dipakai guru; berkasnya jadi lebih besar, tapi tetap
       // ZIP yang sah dan dibuka normal oleh Excel/Google Sheets/LibreOffice.
       function zipStore(entries, date) {
           const when = date instanceof Date && !isNaN(date.getTime()) ? date : new Date();
           const dosTime = ((when.getHours() & 0x1F) << 11) | ((when.getMinutes() & 0x3F) << 5) | ((Math.floor(when.getSeconds() / 2)) & 0x1F);
           const dosDate = (((Math.max(1980, when.getFullYear()) - 1980) & 0x7F) << 9) | (((when.getMonth() + 1) & 0x0F) << 5) | (when.getDate() & 0x1F);

           const local = [];
           const central = [];
           let offset = 0;
           const u16 = (arr, v) => { arr.push(v & 0xFF, (v >>> 8) & 0xFF); };
           const u32 = (arr, v) => { arr.push(v & 0xFF, (v >>> 8) & 0xFF, (v >>> 16) & 0xFF, (v >>> 24) & 0xFF); };

           entries.forEach((entry) => {
               const nameBytes = utf8Bytes(entry.name);
               const dataBytes = entry.bytes;
               const sum = crc32(dataBytes);
               const head = [];
               u32(head, 0x04034B50);
               u16(head, 20);      // versi minimum
               u16(head, 0x0800);  // nama berkas UTF-8
               u16(head, 0);       // metode 0 = store
               u16(head, dosTime); u16(head, dosDate);
               u32(head, sum); u32(head, dataBytes.length); u32(head, dataBytes.length);
               u16(head, nameBytes.length); u16(head, 0);
               local.push(head, nameBytes, dataBytes);

               const dir = [];
               u32(dir, 0x02014B50);
               u16(dir, 20); u16(dir, 20);
               u16(dir, 0x0800); u16(dir, 0);
               u16(dir, dosTime); u16(dir, dosDate);
               u32(dir, sum); u32(dir, dataBytes.length); u32(dir, dataBytes.length);
               u16(dir, nameBytes.length); u16(dir, 0); u16(dir, 0);
               u16(dir, 0); u16(dir, 0); u32(dir, 0);
               u32(dir, offset);
               central.push(dir, nameBytes);

               offset += head.length + nameBytes.length + dataBytes.length;
           });

           const centralSize = central.reduce((n, part) => n + part.length, 0);
           const end = [];
           u32(end, 0x06054B50);
           u16(end, 0); u16(end, 0);
           u16(end, entries.length); u16(end, entries.length);
           u32(end, centralSize); u32(end, offset);
           u16(end, 0);

           const parts = local.concat(central, [end]);
           const total = parts.reduce((n, part) => n + part.length, 0);
           const out = new Uint8Array(total);
           let pos = 0;
           parts.forEach((part) => { out.set(part, pos); pos += part.length; });
           return out;
       }

       // ===== XLSX =====
       function escapeXml(value) {
           return String(value == null ? '' : value)
               .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
               .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
               // Karakter kontrol tidak sah di XML 1.0 — dibuang, bukan
               // dibiarkan bikin berkasnya ditolak Excel.
               .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
       }

       function columnLetter(index) {
           let n = index + 1;
           let s = '';
           while (n > 0) {
               const rem = (n - 1) % 26;
               s = String.fromCharCode(65 + rem) + s;
               n = Math.floor((n - 1) / 26);
           }
           return s;
       }

       // Nama sheet Excel: maksimal 31 karakter dan tidak boleh memuat : \ / ? * [ ]
       function sanitizeSheetName(name) {
           const cleaned = String(name || 'Laporan').replace(/[:\\\/\?\*\[\]]/g, '-').trim();
           return (cleaned || 'Laporan').slice(0, 31);
       }

       function xlsxCell(ref, value, styleIndex) {
           const style = styleIndex ? ` s="${styleIndex}"` : '';
           if (typeof value === 'number' && isFinite(value)) {
               return `<c r="${ref}"${style}><v>${value}</v></c>`;
           }
           const text = String(value == null ? '' : value);
           if (!text) return `<c r="${ref}"${style}/>`;
           return `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${escapeXml(text)}</t></is></c>`;
       }

       function buildXlsxBytes(report, now) {
           const columns = (report && report.columns) || [];
           const rows = (report && report.rows) || [];
           const sheetName = sanitizeSheetName(report && report.jenisLabel);

           // Blok identitas di atas tabel — supaya berkas yang sudah terlepas
           // dari aplikasi tetap menjelaskan dirinya sendiri (periode & cakupan).
           const meta = [
               [`${(report && report.sekolah) || 'SIGAP'} - SIGAP`],
               [(report && report.judul) || 'LAPORAN'],
               ['Jenis Data', (report && report.jenisLabel) || ''],
               ['Periode', (report && report.periodeLabel) || ''],
               ['Kelas/Cakupan', (report && report.scopeLabel) || ''],
               ['Jumlah Record', rows.length],
               ['Dibuat', (report && report.dibuatPada) || ''],
               [],
           ];

           const xmlRows = [];
           let rowNum = 0;
           meta.forEach((line) => {
               rowNum++;
               if (!line.length) { xmlRows.push(`<row r="${rowNum}"/>`); return; }
               const cells = line.map((v, i) => xlsxCell(`${columnLetter(i)}${rowNum}`, v, (rowNum <= 2 || i === 0) ? 1 : 0));
               xmlRows.push(`<row r="${rowNum}">${cells.join('')}</row>`);
           });
           rowNum++;
           const headerRow = rowNum;
           xmlRows.push(`<row r="${headerRow}">${columns.map((c, i) => xlsxCell(`${columnLetter(i)}${headerRow}`, c, 1)).join('')}</row>`);
           rows.forEach((row) => {
               rowNum++;
               const cells = (row || []).map((v, i) => xlsxCell(`${columnLetter(i)}${rowNum}`, v, 0));
               xmlRows.push(`<row r="${rowNum}">${cells.join('')}</row>`);
           });

           const widths = columns.map((c, i) => {
               let max = String(c || '').length;
               rows.forEach((row) => { max = Math.max(max, String((row && row[i]) == null ? '' : row[i]).length); });
               return Math.min(52, Math.max(10, max + 2));
           });
           const cols = widths.length
               ? `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>`
               : '';

           const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
               + `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`
               + cols
               + `<sheetData>${xmlRows.join('')}</sheetData></worksheet>`;

           const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
               + `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">`
               + `<sheets><sheet name="${escapeXml(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`;

           const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
               + `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`
               + `<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>`
               + `<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>`
               + `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>`
               + `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>`
               + `<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>`
               + `<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>`
               + `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

           const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
               + `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
               + `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>`
               + `<Default Extension="xml" ContentType="application/xml"/>`
               + `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>`
               + `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
               + `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`;

           const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
               + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
               + `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

           const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
               + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
               + `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>`
               + `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;

           return zipStore([
               { name: '[Content_Types].xml', bytes: utf8Bytes(contentTypes) },
               { name: '_rels/.rels', bytes: utf8Bytes(rootRels) },
               { name: 'xl/workbook.xml', bytes: utf8Bytes(workbookXml) },
               { name: 'xl/_rels/workbook.xml.rels', bytes: utf8Bytes(workbookRels) },
               { name: 'xl/styles.xml', bytes: utf8Bytes(stylesXml) },
               { name: 'xl/worksheets/sheet1.xml', bytes: utf8Bytes(sheetXml) },
           ], now);
       }

       // ===== PDF =====
       const PDF_PAGE_W = 842;   // A4 mendatar — tabel 6-7 kolom tidak muat rapi di tegak
       const PDF_PAGE_H = 595;
       const PDF_MARGIN = 36;
       const PDF_ROW_H = 15;
       const PDF_FONT_SIZE = 8.5;
       const PDF_HEAD_SIZE = 9;
       // Tabel lebar (Izin Keluar punya 14 kolom, jenis lain 6-7) memakai
       // huruf lebih kecil. Bukan kosmetik: lebar kolom dibagi proporsional
       // dari lebar halaman yang tetap, jadi pada 14 kolom ukuran 8.5pt
       // memotong isi kolom pendek sampai SALAH — tanggal "14/01/2026" keluar
       // sebagai "14/01.." dan nama siswa jadi "R..". Ambangnya di atas jumlah
       // kolom laporan mana pun yang sudah ada, jadi berkas laporan lama
       // keluar persis sama seperti sebelumnya.
       const PDF_WIDE_COLS = 10;
       const pdfFontSizes = (columns) => ((columns || []).length > PDF_WIDE_COLS
           // head == body di sini (bukan 0.5pt lebih besar seperti tabel biasa):
           // lebar kolom dihitung dari ukuran BODY, jadi judul yang sedikit
           // lebih besar justru ikut terpotong. Judul tetap terbedakan lewat
           // huruf tebal + pita abu-abunya.
           ? { body: 7, head: 7 }
           : { body: PDF_FONT_SIZE, head: PDF_HEAD_SIZE });
       // Helvetica rata-rata ±0.5 x ukuran font per karakter. Dipakai hanya
       // untuk memotong teks yang kepanjangan supaya tidak tabrakan antar
       // kolom — tidak perlu presisi tipografis.
       const PDF_CHAR_RATIO = 0.5;

       function pdfEscape(text) {
           return String(text == null ? '' : text)
               // Karakter "pintar" hasil salin-tempel dari WhatsApp/Word
               // diturunkan ke padanan ASCII-nya dulu.
               .replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
               .replace(/[–—]/g, '-').replace(/…/g, '...')
               .replace(/[\r\n\t]+/g, ' ')
               .replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
       }

       function fitPdfText(text, widthPt, fontSize) {
           const s = String(text == null ? '' : text);
           const maxChars = Math.max(1, Math.floor(widthPt / (fontSize * PDF_CHAR_RATIO)));
           if (s.length <= maxChars) return s;
           // '..' (ASCII), bukan karakter elipsis — font PDF di sini dipakai
           // dengan WinAnsiEncoding, jadi tetap di wilayah aman.
           return s.slice(0, Math.max(1, maxChars - 2)) + '..';
       }

       // Lebar tiap kolom. Dulu murni proporsional terhadap panjang isi
       // terpanjangnya, dan itu punya cacat yang baru terlihat pada tabel
       // lebar: kolom pendek TAPI TIDAK BOLEH TERPOTONG (tanggal, kelas)
       // kalah bersaing dengan kolom panjang, lalu tercetak sebagai
       // "14/01/2.." — tanggal yang salah baca, bukan sekadar sempit.
       //
       // Sekarang: kalau semua kolom muat utuh di satu halaman, itu yang
       // dipakai (sisa ruangnya dibagi proporsional). Kalau memang tidak
       // muat, barulah jatuh ke pembagian proporsional yang lama — perilaku
       // untuk laporan yang isinya sangat panjang tidak berubah.
       function pdfColumnWidths(columns, rows, avail, bodySize) {
           const weights = columns.map((c, i) => {
               let max = String(c || '').length;
               rows.forEach((row) => {
                   const len = String((row && row[i]) == null ? '' : row[i]).length;
                   if (len > max) max = len;
               });
               return Math.max(5, Math.min(42, max));
           });
           const sum = weights.reduce((a, b) => a + b, 0) || 1;
           // +6 = padding kiri/kanan sel, sama dengan yang dipakai fitPdfText.
           const charW = (bodySize || PDF_FONT_SIZE) * PDF_CHAR_RATIO;
           const ideal = weights.map((w) => w * charW + 6);
           const idealSum = ideal.reduce((a, b) => a + b, 0) || 1;
           if (idealSum <= avail) {
               const sisa = avail - idealSum;
               return ideal.map((w) => w + (sisa * w) / idealSum);
           }
           return weights.map((w) => (avail * w) / sum);
       }

       function buildPdfBytes(report) {
           const columns = (report && report.columns) || [];
           const rows = (report && report.rows) || [];
           const avail = PDF_PAGE_W - PDF_MARGIN * 2;
           const fontSize = pdfFontSizes(columns);
           const widths = pdfColumnWidths(columns, rows, avail, fontSize.body);

           const drawText = (parts, text, x, y, size, bold) => {
               parts.push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf 1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm (${pdfEscape(text)}) Tj ET`);
           };
           const drawRect = (parts, x, y, w, h, gray) => {
               parts.push(`${gray} ${gray} ${gray} rg ${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f 0 0 0 rg`);
           };
           const drawHeaderRow = (parts, y) => {
               drawRect(parts, PDF_MARGIN, y - 4, avail, PDF_ROW_H + 2, 0.87);
               let x = PDF_MARGIN;
               columns.forEach((c, i) => {
                   drawText(parts, fitPdfText(c, widths[i] - 6, fontSize.head), x + 3, y, fontSize.head, true);
                   x += widths[i];
               });
           };

           // ---- Bagi baris ke halaman ----
           const firstPageTop = PDF_PAGE_H - PDF_MARGIN - 96; // sisakan ruang kop + metadata
           const nextPageTop = PDF_PAGE_H - PDF_MARGIN - 28;
           const bottom = PDF_MARGIN + 24;
           const capacity = (top) => Math.max(1, Math.floor((top - bottom) / PDF_ROW_H) - 1);
           const pagesRows = [];
           if (!rows.length) {
               pagesRows.push([]);
           } else {
               let index = 0;
               while (index < rows.length) {
                   const top = pagesRows.length === 0 ? firstPageTop : nextPageTop;
                   const take = capacity(top);
                   pagesRows.push(rows.slice(index, index + take));
                   index += take;
               }
           }

           // ---- Gambar tiap halaman ----
           const contents = pagesRows.map((pageRows, pageIndex) => {
               const parts = [];
               let y;
               if (pageIndex === 0) {
                   y = PDF_PAGE_H - PDF_MARGIN - 12;
                   drawText(parts, `SIGAP - ${(report && report.sekolah) || ''}`.trim(), PDF_MARGIN, y, 14, true);
                   y -= 20;
                   drawText(parts, (report && report.judul) || 'LAPORAN', PDF_MARGIN, y, 12, true);
                   y -= 8;
                   drawRect(parts, PDF_MARGIN, y, avail, 0.8, 0.35);
                   y -= 14;
                   const meta = [
                       `Jenis Data   : ${(report && report.jenisLabel) || '-'}`,
                       `Periode      : ${(report && report.periodeLabel) || '-'}`,
                       `Kelas/Cakupan: ${(report && report.scopeLabel) || '-'}`,
                       `Jumlah Record: ${rows.length}`,
                       `Dibuat       : ${(report && report.dibuatPada) || '-'}`,
                   ];
                   meta.forEach((line, i) => {
                       // Dua kolom supaya kop tidak memakan tinggi halaman.
                       const col = i < 3 ? 0 : 1;
                       const row = i < 3 ? i : i - 3;
                       drawText(parts, line, PDF_MARGIN + col * (avail / 2), y - row * 12, 9, false);
                   });
                   y -= 3 * 12 + 6;
               } else {
                   y = PDF_PAGE_H - PDF_MARGIN - 10;
                   drawText(parts, `${(report && report.judul) || 'LAPORAN'} (lanjutan)`, PDF_MARGIN, y, 9, true);
                   y -= 14;
               }

               drawHeaderRow(parts, y);
               y -= PDF_ROW_H + 4;

               if (!pageRows.length && pageIndex === 0) {
                   drawText(parts, 'Tidak ada data pada periode & cakupan ini.', PDF_MARGIN + 3, y, 9, false);
               }
               pageRows.forEach((row) => {
                   let x = PDF_MARGIN;
                   columns.forEach((c, i) => {
                       const value = (row && row[i]) == null ? '' : row[i];
                       const text = fitPdfText(value, widths[i] - 6, fontSize.body);
                       if (typeof value === 'number') {
                           // Angka (Rekap Siswa) rata kanan supaya mudah dibaca menurun.
                           const w = String(value).length * fontSize.body * PDF_CHAR_RATIO;
                           drawText(parts, text, x + widths[i] - 3 - w, y, fontSize.body, false);
                       } else {
                           drawText(parts, text, x + 3, y, fontSize.body, false);
                       }
                       x += widths[i];
                   });
                   drawRect(parts, PDF_MARGIN, y - 4, avail, 0.4, 0.8);
                   y -= PDF_ROW_H;
               });

               const footerLeft = `SIGAP - ${(report && report.sekolah) || ''} | dokumen internal sekolah`.trim();
               drawText(parts, footerLeft, PDF_MARGIN, PDF_MARGIN - 12, 7.5, false);
               const pageLabel = `Halaman ${pageIndex + 1} dari ${pagesRows.length}`;
               drawText(parts, pageLabel, PDF_PAGE_W - PDF_MARGIN - pageLabel.length * 7.5 * PDF_CHAR_RATIO, PDF_MARGIN - 12, 7.5, false);
               return parts.join('\n');
           });

           // ---- Susun objek PDF ----
           // 1 Catalog, 2 Pages, 3 Helvetica, 4 Helvetica-Bold, lalu
           // pasangan (Page, Contents) untuk tiap halaman.
           const objects = [];
           objects.push('<< /Type /Catalog /Pages 2 0 R >>');
           objects.push('');
           objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
           objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
           const kids = [];
           contents.forEach((content, i) => {
               const pageObj = 5 + i * 2;
               const contentObj = pageObj + 1;
               kids.push(`${pageObj} 0 R`);
               objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PDF_PAGE_W} ${PDF_PAGE_H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentObj} 0 R >>`);
               objects.push(`<< /Length ${latin1Bytes(content).length} >>\nstream\n${content}\nendstream`);
           });
           objects[1] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${contents.length} >>`;

           let pdf = '%PDF-1.4\n%âãÏÓ\n';
           const offsets = [];
           objects.forEach((body, i) => {
               offsets.push(pdf.length);
               pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
           });
           const xrefOffset = pdf.length;
           pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
           offsets.forEach((off) => { pdf += `${String(off).padStart(10, '0')} 00000 n \n`; });
           pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
           return latin1Bytes(pdf);
       }

       // ===== Nama berkas & unduh =====
       function buildExportFilename(report, format, periodeStart, periodeEnd) {
           const jenis = String((report && report.jenisLabel) || 'Laporan').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '');
           const scope = String((report && report.scopeLabel) || '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '');
           const periode = [periodeStart, periodeEnd].filter(Boolean).join('_sd_') || new Date().toISOString().slice(0, 10);
           const ext = format === 'xlsx' ? 'xlsx' : 'pdf';
           return `SIGAP_${jenis}${scope ? '_' + scope : ''}_${periode}.${ext}`;
       }

       const EXPORT_MIME = {
           pdf: 'application/pdf',
           xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
       };

       // Pola unduh yang sama dengan exportCSV() di helpers.js.
       function downloadBytes(bytes, filename, mime) {
           const blob = new Blob([bytes], { type: mime });
           const url = URL.createObjectURL(blob);
           const a = document.createElement('a');
           a.href = url;
           a.download = filename;
           document.body.appendChild(a);
           a.click();
           document.body.removeChild(a);
           URL.revokeObjectURL(url);
       }

       // Satu pintu dipakai app.js: report (dari server) + format -> berkas terunduh.
       function generateExportFile(report, format, periodeStart, periodeEnd) {
           const fmt = format === 'xlsx' ? 'xlsx' : 'pdf';
           const bytes = fmt === 'xlsx' ? buildXlsxBytes(report) : buildPdfBytes(report);
           const filename = buildExportFilename(report, fmt, periodeStart, periodeEnd);
           downloadBytes(bytes, filename, EXPORT_MIME[fmt]);
           return filename;
       }
