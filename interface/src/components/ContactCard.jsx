import React, { useState } from 'react';
import { CONTACT, contactLines, authorsText } from '../contact';

/**
 * "Developed by …" card with the team and contact (data in src/contact.js).
 *   variant="footer": text line for the start screen;
 *   variant="chip" (default): discreet label in the corner of the screen, "Powered by <names>" with the e-mails below and an "ⓘ About" button that opens the card
 *   (names and e-mails stay visible in screenshots).
 */
export default function ContactCard({ darkMode, variant = 'chip', contact = CONTACT, initialOpen = false }) {
    const [open, setOpen] = useState(initialOpen);
    const { authors, links } = contactLines(contact);
    if (!authors.length && !links.length) return null;
    const fg = darkMode ? '#e8e8e8' : '#222';
    const muted = darkMode ? '#9a9a9a' : '#666';
    const bg = darkMode ? 'rgba(24,24,28,0.97)' : 'rgba(255,255,255,0.98)';
    const line = darkMode ? '#3a3a40' : '#ddd';
    const linkStyle = { color: '#4da3ff', textDecoration: 'none' };

    const linksEl = links.map((l, i) => (
        <React.Fragment key={l.href}>{i > 0 && ' · '}<a href={l.href} style={linkStyle} target={l.kind === 'repo' ? '_blank' : undefined} rel="noreferrer">{l.label}</a></React.Fragment>
    ));

    if (variant === 'footer') {
        return (
            <div data-testid="contact-footer" style={{ marginTop: 22, paddingTop: 14, borderTop: `1px solid ${line}`, fontSize: 12, color: muted, lineHeight: 1.6 }}>
                {authors.length > 0 && <div>{contact.heading} <b style={{ color: fg }}>{authorsText(authors)}</b></div>}
                {contact.event && <div>{contact.event}</div>}
                {links.length > 0 && <div>{linksEl}</div>}
            </div>
        );
    }

    return (
        <div data-testid="contact-card" style={{ position: 'fixed', bottom: 8, left: '50%', transform: 'translateX(-50%)', zIndex: 900, fontSize: 12 }}>
            {!open && (
                <div data-testid="contact-chip" style={{ background: bg, color: muted, border: `1px solid ${line}`, borderRadius: 12, padding: '3px 12px', fontSize: 12, textAlign: 'center', lineHeight: 1.4, whiteSpace: 'nowrap' }}>
                    <div>
                        {authors.length > 0 && <>{contact.poweredBy || contact.heading} <b data-testid="contact-names" style={{ color: fg, fontWeight: 600 }}>{authors.map(a => a.name).join(' & ')}</b> </>}
                        <button onClick={() => setOpen(true)} title="Who developed it, affiliations and how to get in touch"
                            style={{ background: 'transparent', color: muted, border: `1px solid ${line}`, borderRadius: 10, padding: '0 8px', cursor: 'pointer', fontSize: 11, marginLeft: 4 }}>ⓘ About</button>
                    </div>
                    {links.some(l => l.kind === 'email') && (
                        <div data-testid="contact-emails" style={{ fontSize: 11 }}>
                            {links.filter(l => l.kind === 'email').map((l, i) => (
                                <React.Fragment key={l.href}>{i > 0 && ' · '}<a href={l.href} style={linkStyle}>{l.label}</a></React.Fragment>
                            ))}
                        </div>
                    )}
                </div>
            )}
            {open && (
                <div style={{ background: bg, color: fg, border: `1px solid ${line}`, borderRadius: 10, padding: '10px 14px', minWidth: 300, maxWidth: 440, boxShadow: '0 6px 24px rgba(0,0,0,0.35)', lineHeight: 1.55 }}>
                    <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
                        <b style={{ flex: 1 }}>{contact.heading}</b>
                        <button onClick={() => setOpen(false)} title="Close" style={{ background: 'transparent', border: 'none', color: muted, cursor: 'pointer', fontSize: 14 }}>✖</button>
                    </div>
                    {authors.map(a => (
                        <div key={a.name} style={{ marginTop: 6 }}>
                            <b>{a.name}</b>
                            {a.affiliations.map(f => <div key={f} style={{ color: muted, fontSize: 11, lineHeight: 1.4 }}>{f}</div>)}
                            {a.email && <div style={{ fontSize: 11 }}><a href={`mailto:${a.email}`} style={linkStyle}>{a.email}</a></div>}
                        </div>
                    ))}
                    {contact.event && <div style={{ color: muted, marginTop: 8 }}>{contact.event}</div>}
                    {links.some(l => l.kind === 'repo') && <div style={{ marginTop: 4 }}>{links.filter(l => l.kind === 'repo').map(l => <a key={l.href} href={l.href} style={linkStyle} target="_blank" rel="noreferrer">{l.label}</a>)}</div>}
                    {contact.credit && <div style={{ color: muted, fontSize: 11, marginTop: 6 }}>{contact.credit}</div>}
                </div>
            )}
        </div>
    );
}
