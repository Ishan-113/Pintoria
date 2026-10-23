import { useEffect, useRef, useState } from 'react';
import * as api from '../api/endpoints';
import { useSession } from '../auth/session';
import { Banner, Empty, ErrBanner, Field } from './ui';

const KIND_LABEL: Record<string, string> = {
  requirement_spec: 'Requirement spec',
  quotation_document: 'Quotation document',
  po_document: 'PO document',
  reference: 'Reference',
  other: 'Other',
};

const KIND_OPTIONS = ['requirement_spec', 'quotation_document', 'po_document', 'reference', 'other'];

export function FilesPanel({ order }: { order: api.OrderDetail }) {
  const { user } = useSession();

  const [files, setFiles] = useState<api.FileRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState('');
  const [kind, setKind] = useState('requirement_spec');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const canUpload = user?.role.startsWith('CLIENT_') || user?.role.startsWith('PRINTORIA_');
  const isRegional = user?.role === 'CLIENT_REGIONAL';

  const load = () => {
    api
      .listOrderFiles(order.id)
      .then((res) => {
        setFiles(res.files);
        setLoaded(true);
      })
      .catch(setError);
  };

  // re-fetch when the order advances (parent refreshes -> status changes)
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order.id, order.status]);

  const upload = async () => {
    const picked = inputRef.current?.files?.[0];
    if (!picked) {
      setNotice('');
      return;
    }
    setBusy(true);
    setError(null);
    setNotice('');
    try {
      await api.uploadOrderFile(order.id, picked, kind as never);
      if (inputRef.current) inputRef.current.value = '';
      setNotice('File uploaded and virus-scanned.');
      load();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const download = async (f: api.FileRow) => {
    setBusy(true);
    setError(null);
    try {
      await api.downloadOrderFile(f.id, f.originalName, (m) => setNotice(m));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <ErrBanner error={error} />
      {notice && <Banner kind="ok">{notice}</Banner>}

      {canUpload && (
        <div className="files-upload">
          <Field label="Document kind" hint={isRegional ? 'PO documents are handled by your head office.' : undefined}>
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              {KIND_OPTIONS.filter((k) => !(isRegional && k === 'po_document')).map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="File" hint="PDF/JPG/PNG/XLSX/DOCX — max 25 MB (configured by admin)">
            <input ref={inputRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.xlsx,.docx,.ai,.cdr" />
          </Field>
          <button className="btn" disabled={busy} onClick={upload}>
            {busy ? 'Uploading…' : 'Upload'}
          </button>
        </div>
      )}

      {files.length === 0 && loaded && <Empty>Yet to attach any documents.</Empty>}
      {files.length > 0 && (
        <table className="table compact">
          <thead>
            <tr>
              <th>Name</th>
              <th>Kind</th>
              <th>Size</th>
              <th>Scan</th>
              <th>Uploaded</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {files.map((f) => (
              <tr key={f.id}>
                <td>{f.originalName}</td>
                <td>{KIND_LABEL[f.kind] ?? f.kind}</td>
                <td>{Math.max(1, Math.round(f.sizeBytes / 1024))} KB</td>
                <td>
                  <span className={`tag ${f.scanStatus === 'CLEAN' ? 'green' : 'amber'}`}>{f.scanStatus}</span>
                </td>
                <td>{new Date(f.createdAt).toLocaleString()}</td>
                <td>
                  <button className="btn tiny" disabled={busy} onClick={() => download(f)}>
                    Download
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
