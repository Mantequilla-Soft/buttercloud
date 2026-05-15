// Icons — simple line set. Stroke-based, 16/18px viewBox.

const Ico = ({ d, size = 16, sw = 1.6, fill = "none", style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={fill}
       stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round"
       style={style}>
    {typeof d === "string" ? <path d={d} /> : d}
  </svg>
);

const I = {
  bucket: (p) => (
    <Ico {...p} d={<>
      <path d="M4 7h16l-1.4 11.2A2 2 0 0 1 16.6 20H7.4a2 2 0 0 1-2-1.8L4 7Z" />
      <path d="M4 7c0-1.7 3.6-3 8-3s8 1.3 8 3" />
      <path d="M4 7c0 1.7 3.6 3 8 3s8-1.3 8-3" opacity=".5" />
    </>} />
  ),
  folder: (p) => (
    <Ico {...p} d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
  ),
  file: (p) => (
    <Ico {...p} d={<>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z" />
      <path d="M14 3v5h5" />
    </>} />
  ),
  search: (p) => (
    <Ico {...p} d={<>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </>} />
  ),
  chevR: (p) => <Ico {...p} d="m9 6 6 6-6 6" />,
  chevL: (p) => <Ico {...p} d="m15 6-6 6 6 6" />,
  chevD: (p) => <Ico {...p} d="m6 9 6 6 6-6" />,
  arrowL: (p) => <Ico {...p} d={<><path d="M19 12H5" /><path d="m12 19-7-7 7-7" /></>} />,
  upload: (p) => (
    <Ico {...p} d={<>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="m17 8-5-5-5 5" />
      <path d="M12 3v12" />
    </>} />
  ),
  download: (p) => (
    <Ico {...p} d={<>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="m7 10 5 5 5-5" />
      <path d="M12 15V3" />
    </>} />
  ),
  share: (p) => (
    <Ico {...p} d={<>
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <path d="m8.6 13.5 6.8 4" />
      <path d="m15.4 6.5-6.8 4" />
    </>} />
  ),
  copy: (p) => (
    <Ico {...p} d={<>
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
    </>} />
  ),
  link: (p) => (
    <Ico {...p} d={<>
      <path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1" />
      <path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" />
    </>} />
  ),
  trash: (p) => (
    <Ico {...p} d={<>
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M19 6 18 20a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
    </>} />
  ),
  more: (p) => (
    <Ico {...p} d={<>
      <circle cx="5" cy="12" r="1.4" />
      <circle cx="12" cy="12" r="1.4" />
      <circle cx="19" cy="12" r="1.4" />
    </>} />
  ),
  plus: (p) => <Ico {...p} d="M12 5v14M5 12h14" />,
  refresh: (p) => (
    <Ico {...p} d={<>
      <path d="M3 12a9 9 0 0 1 15.5-6.3L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-15.5 6.3L3 16" />
      <path d="M3 21v-5h5" />
    </>} />
  ),
  filter: (p) => <Ico {...p} d="M4 5h16l-6 8v6l-4-2v-4L4 5Z" />,
  sort: (p) => (
    <Ico {...p} d={<>
      <path d="M3 6h13" />
      <path d="M3 12h9" />
      <path d="M3 18h5" />
      <path d="m17 9 4-4 4 4" transform="translate(-4 9)" />
    </>} />
  ),
  list: (p) => (
    <Ico {...p} d={<>
      <path d="M8 6h13M8 12h13M8 18h13" />
      <circle cx="4" cy="6" r="1" />
      <circle cx="4" cy="12" r="1" />
      <circle cx="4" cy="18" r="1" />
    </>} />
  ),
  grid: (p) => (
    <Ico {...p} d={<>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </>} />
  ),
  lock: (p) => (
    <Ico {...p} d={<>
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </>} />
  ),
  globe: (p) => (
    <Ico {...p} d={<>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18Z" />
    </>} />
  ),
  eye: (p) => (
    <Ico {...p} d={<>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </>} />
  ),
  tag: (p) => (
    <Ico {...p} d={<>
      <path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9-9-9Z" />
      <circle cx="8" cy="8" r="1.4" />
    </>} />
  ),
  key: (p) => (
    <Ico {...p} d={<>
      <circle cx="8" cy="15" r="4" />
      <path d="m10.8 12.2 9.2-9.2" />
      <path d="m17 6 3 3" />
      <path d="m15 8 3 3" />
    </>} />
  ),
  zap: (p) => (
    <Ico {...p} d="M13 3 4 14h7l-1 7 9-11h-7l1-7Z" />
  ),
  activity: (p) => <Ico {...p} d="M3 12h4l3-9 4 18 3-9h4" />,
  gauge: (p) => (
    <Ico {...p} d={<>
      <path d="M12 14 9 11" />
      <path d="M3.5 18a9 9 0 1 1 17 0" />
    </>} />
  ),
  card: (p) => (
    <Ico {...p} d={<>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 10h18" />
    </>} />
  ),
  settings: (p) => (
    <Ico {...p} d={<>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h.1a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v.1a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
    </>} />
  ),
  help: (p) => (
    <Ico {...p} d={<>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9.5a2.5 2.5 0 0 1 5 0c0 1.5-2.5 2-2.5 4" />
      <circle cx="12" cy="17.5" r="0.6" fill="currentColor" />
    </>} />
  ),
  bell: (p) => (
    <Ico {...p} d={<>
      <path d="M6 19V11a6 6 0 0 1 12 0v8" />
      <path d="M4 19h16" />
      <path d="M10 22a2 2 0 0 0 4 0" />
    </>} />
  ),
  command: (p) => (
    <Ico {...p} d={<>
      <path d="M6 9a3 3 0 1 1 3-3v12a3 3 0 1 1-3-3" />
      <path d="M18 15a3 3 0 1 1-3 3V6a3 3 0 1 1 3 3" />
      <path d="M9 9h6v6H9z" />
    </>} />
  ),
  up: (p) => <Ico {...p} d="m6 15 6-6 6 6" />,
  dn: (p) => <Ico {...p} d="m6 9 6 6 6-6" />,
  sun: (p) => (
    <Ico {...p} d={<>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>} />
  ),
  moon: (p) => (
    <Ico {...p} d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
  ),
  external: (p) => (
    <Ico {...p} d={<>
      <path d="M14 3h7v7" />
      <path d="M10 14 21 3" />
      <path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5" />
    </>} />
  ),
  star: (p) => <Ico {...p} d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.5 2.9 1-6.1L3 9.5l6.1-.9L12 3Z" />,
  rail: (p) => (
    <Ico {...p} d={<>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M15 4v16" />
    </>} />
  ),
  versions: (p) => (
    <Ico {...p} d={<>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>} />
  ),
};

export { I };
