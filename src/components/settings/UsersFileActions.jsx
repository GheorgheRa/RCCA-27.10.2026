import React, { useRef, useState } from 'react';
import { backend } from '@/api/backendClient';
import { Button } from '@/components/ui/button';
import { FileText, FileSpreadsheet, Table, Upload, UserPlus, X, KeyRound, Eye, EyeOff } from 'lucide-react';
import { utils, writeFile, read } from 'xlsx';
import { jsPDF } from 'jspdf';
import { Input } from '@/components/ui/input';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const normalizeKey = (obj, keys) => {
  for (const k of keys) {
    const clean = k.toLowerCase().replace(/[\s_()-]/g, '');
    const found = Object.keys(obj).find((ok) => ok.toLowerCase().replace(/[\s_()-]/g, '') === clean);
    if (found && obj[found]) return obj[found];
  }
  return undefined;
};

export default function UsersFileActions({ title, headers, rows, existingEmails, onInvited }) {
  const fileRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null);
  const [pending, setPending] = useState(null);
  const [inviting, setInviting] = useState(false);
  const [defaultPassword, setDefaultPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const fileBase = () => `${title.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}`;

  const downloadBlob = (content, mime, filename) => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportCsv = () => {
    const csv = [headers, ...rows]
      .map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(','))
      .join('\n');
    downloadBlob('\uFEFF' + csv, 'text/csv;charset=utf-8', `${fileBase()}.csv`);
  };

  const exportExcel = () => {
    const ws = utils.aoa_to_sheet([headers, ...rows]);
    const wb = utils.book_new();
    utils.book_append_sheet(wb, ws, 'Users');
    writeFile(wb, `${fileBase()}.xlsx`);
  };

  const exportPdf = () => {
    const doc = new jsPDF();
    const pageW = doc.internal.pageSize.getWidth();
    const margin = 14;
    const colW = (pageW - margin * 2) / headers.length;
    doc.setFontSize(14);
    doc.text(title, margin, 15);
    let y = 24;
    doc.setFontSize(10);
    doc.setFillColor(37, 99, 235);
    doc.setTextColor(255, 255, 255);
    doc.rect(margin, y, pageW - margin * 2, 7, 'F');
    headers.forEach((h, i) => doc.text(String(h), margin + colW * i + 2, y + 5));
    y += 7;
    doc.setTextColor(30, 41, 59);
    rows.forEach((r, ri) => {
      if (y > 280) { doc.addPage(); y = 15; }
      if (ri % 2 === 1) { doc.setFillColor(241, 245, 249); doc.rect(margin, y, pageW - margin * 2, 6, 'F'); }
      r.forEach((c, i) => {
        const lines = doc.splitTextToSize(String(c ?? ''), colW - 4);
        doc.text(lines[0] || '', margin + colW * i + 2, y + 4.5);
      });
      y += 6;
    });
    doc.save(`${fileBase()}.pdf`);
  };

  const handleImport = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setBusy(true);
    setStatus(null);
    setPending(null);
    try {
      let extracted = [];
      const isSpreadsheet = /\.(csv|tsv|xlsx?)(\?|$)/i.test(file.name) || file.type.includes('csv') || file.type.includes('spreadsheet') || file.type.includes('excel');
      if (isSpreadsheet) {
        const arrayBuffer = await file.arrayBuffer();
        const workbook = read(arrayBuffer, { type: 'array' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        extracted = utils.sheet_to_json(sheet, { defval: '', raw: false });
      } else {
        const { file_url } = await backend.integrations.Core.UploadPublicFile({ file });
        const res = await backend.functions.invoke('importUsersFile', { file_url });
        extracted = res.data?.rows || [];
      }

      const existing = new Set((existingEmails || []).map(em => String(em).toLowerCase()));
      const seen = new Set();
      const toInvite = [];
      extracted.forEach((row) => {
        const email = String(row.email ?? normalizeKey(row, ['email', 'mail', 'e-mail']) ?? '').trim();
        const role = String(row.role ?? normalizeKey(row, ['role', 'type']) ?? '').trim().toLowerCase() === 'admin' ? 'admin' : 'user';
        const name = String(row.name ?? normalizeKey(row, ['name', 'full_name', 'fullname', 'display_name', 'displayname']) ?? '').trim();
        const password = String(row.password ?? normalizeKey(row, ['password', 'pwd', 'pass']) ?? '').trim();
        const key = email.toLowerCase();
        if (!EMAIL_RE.test(email) || existing.has(key) || seen.has(key)) return;
        seen.add(key);
        toInvite.push({ email, role, name, password });
      });
      if (!toInvite.length) {
        setStatus(extracted.length ? 'No new users found in file.' : 'No users found in file.');
      } else {
        setPending(toInvite);
      }
    } catch (err) {
      setStatus(`Import failed: ${err.message}`);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const doInvite = async () => {
    setInviting(true);
    try {
      const useDefault = defaultPassword.trim();
      const res = await backend.users.bulkCreateUsers(pending, useDefault || undefined);
      const created = res.data?.created ?? 0;
      const failed = res.data?.failed ?? 0;
      const errs = res.data?.errors ?? [];
      setStatus(
        `Created ${created} user(s)${failed ? `, ${failed} failed` : ''}.` +
        (errs.length ? ` Errors: ${errs.slice(0, 3).join('; ')}${errs.length > 3 ? '...' : ''}` : '')
      );
    } catch (err) {
      setStatus(`Import failed: ${err.message}`);
    }
    setPending(null);
    setInviting(false);
    setDefaultPassword('');
    onInvited?.();
  };

  const hasPasswordInFile = pending?.some(r => r.password);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-slate-400">Export:</span>
        <Button size="sm" variant="outline" className="h-7 px-2 text-xs gap-1" onClick={exportPdf} disabled={!rows.length}>
          <FileText className="w-3.5 h-3.5" /> PDF
        </Button>
        <Button size="sm" variant="outline" className="h-7 px-2 text-xs gap-1" onClick={exportExcel} disabled={!rows.length}>
          <FileSpreadsheet className="w-3.5 h-3.5" /> Excel
        </Button>
        <Button size="sm" variant="outline" className="h-7 px-2 text-xs gap-1" onClick={exportCsv} disabled={!rows.length}>
          <Table className="w-3.5 h-3.5" /> CSV
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.xlsx,.pdf"
          className="hidden"
          onChange={handleImport}
        />
        <Button size="sm" variant="outline" className="h-7 px-2 text-xs gap-1" onClick={() => fileRef.current?.click()} disabled={busy}>
          <Upload className="w-3.5 h-3.5" /> Import (PDF / Excel / CSV)
        </Button>
        {busy && <span className="text-xs text-slate-500">Reading file...</span>}
        {status && <span className="text-xs text-slate-500">{status}</span>}
      </div>
      {pending && (
        <div className="space-y-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-slate-700">
              {pending.length} new user(s) ready to create.
            </span>
          </div>
          {!hasPasswordInFile && (
            <div className="flex items-center gap-2">
              <KeyRound className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
              <div className="relative flex-1 max-w-xs">
                <Input
                  type={showPassword ? 'text' : 'password'}
                  value={defaultPassword}
                  onChange={e => setDefaultPassword(e.target.value)}
                  placeholder="Default password for all users (min 6 chars)"
                  className="h-7 text-xs pr-8"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(s => !s)}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  {showPassword ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                </button>
              </div>
            </div>
          )}
          <div className="text-xs text-slate-500">
            {hasPasswordInFile
              ? 'Each user will be created with the password from the file.'
              : defaultPassword.trim()
                ? `All users will be created with the password "${showPassword ? defaultPassword : '••••••'}" and can sign in immediately.`
                : 'Without a password, users will receive an invite email.'}
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" className="h-7 px-2 text-xs gap-1" onClick={doInvite} disabled={inviting}>
              <UserPlus className="w-3.5 h-3.5" /> {inviting ? 'Creating...' : `Create ${pending.length} user(s)`}
            </Button>
            <Button size="sm" variant="outline" className="h-7 px-2 text-xs gap-1" onClick={() => setPending(null)} disabled={inviting}>
              <X className="w-3.5 h-3.5" /> Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
