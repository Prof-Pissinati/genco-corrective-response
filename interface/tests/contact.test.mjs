// "Developed by" card: shows only what is filled in, joins the names and lists the affiliations and e-mail of each author.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CONTACT, contactLines, authorsText } from '../src/contact.js';

let server, ContactCard;
before(async () => {
    server = await createServer({ configFile: false, plugins: [(await import('@vitejs/plugin-react')).default()], server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent', optimizeDeps: { noDiscovery: true } });
    ContactCard = (await server.ssrLoadModule('/src/components/ContactCard.jsx')).default;
});
after(async () => { await server?.close(); });

const cheio = { heading: 'Developed by', authors: [{ name: 'Ana Souza', affiliations: ['Instituto A', 'Lab B'], email: 'ana@exemplo.org' }, { name: 'Bruno Lima', affiliations: [], email: '' }],
    email: 'equipe@exemplo.org', repoUrl: 'https://github.com/x/y', event: 'Event', credit: 'Credit' };

test('real configuration: authors of CITATION.cff with the affiliations and e-mails they provided', () => {
    const { authors, links } = contactLines(CONTACT);
    assert.deepEqual(authors.map(a => a.name), ['Rafael Pissinati de Souza', 'Leonardo Pilarski']);
    assert.ok(authors.every(a => a.affiliations.length >= 2 && /@/.test(a.email)));
    const rafael = authors[0].affiliations.join('|');
    assert.match(rafael, /UTAD/); assert.match(rafael, /Unesp/); assert.match(rafael, /LAPSE/); assert.match(rafael, /IFRO/);
    assert.match(authors[1].affiliations.join('|'), /HumanISE/);
    assert.deepEqual(links.filter(l => l.kind === 'email').map(l => l.label), ['rafael.pissinati@ifro.edu.br', 'pilarski@utad.pt']);
});

test('card lines: ignores empty fields, no repeated e-mail, with mailto and repository link', () => {
    const { authors, links } = contactLines(cheio);
    assert.equal(authors.length, 2);
    assert.deepEqual(links.map(l => l.href), ['mailto:ana@exemplo.org', 'mailto:equipe@exemplo.org', 'https://github.com/x/y']);
    assert.equal(contactLines({ authors: [{ name: 'A', email: 'a@x.org' }], email: 'A@X.org' }).links.length, 1, 'repeated e-mail (upper/lower case) appears once');
    assert.deepEqual(contactLines({ authors: [{ name: ' ', email: 'x@y' }], email: '  ', repoUrl: '' }), { authors: [], links: [] });
});

test('authors text: names only, with "and" before the last one', () => {
    assert.equal(authorsText([{ name: 'Ana' }, { name: 'Bruno' }]), 'Ana and Bruno');
    assert.equal(authorsText([{ name: 'Ana' }]), 'Ana');
    assert.equal(authorsText([{ name: 'A' }, { name: 'B' }, { name: 'C' }]), 'A, B and C');
    assert.equal(authorsText([]), '');
});

test('card: start-screen footer, closed "About" button and open card with affiliations and e-mails; without data nothing appears', () => {
    const rodape = renderToStaticMarkup(React.createElement(ContactCard, { darkMode: true, variant: 'footer', contact: cheio }));
    assert.match(rodape, /Developed by/); assert.match(rodape, /Ana Souza and Bruno Lima/); assert.match(rodape, /mailto:ana@exemplo\.org/);
    const closed = renderToStaticMarkup(React.createElement(ContactCard, { darkMode: false, contact: cheio }));
    assert.match(closed, /ⓘ About/);
    assert.match(closed, /Developed by <b[^>]*>Ana Souza &amp; Bruno Lima<\/b>/);                      // no poweredBy in the data: falls back to the heading
    const powered = renderToStaticMarkup(React.createElement(ContactCard, { darkMode: false, contact: { ...cheio, poweredBy: 'Powered by' } }));
    assert.match(powered, /Powered by <b[^>]*>Ana Souza &amp; Bruno Lima<\/b>/);
    assert.match(closed, /data-testid="contact-emails"/); assert.match(closed, /mailto:ana@exemplo\.org/); assert.match(closed, /mailto:equipe@exemplo\.org/);   // e-mails always visible, under the names
    assert.doesNotMatch(closed, /Instituto A/);                                                      // affiliations only in the open card
    const opened = renderToStaticMarkup(React.createElement(ContactCard, { darkMode: false, contact: cheio, initialOpen: true }));
    assert.match(opened, /Ana Souza/); assert.match(opened, /Instituto A/); assert.match(opened, /Lab B/); assert.match(opened, /mailto:ana@exemplo\.org/);
    assert.match(opened, /Code on GitHub/); assert.match(opened, /Credit/);
    assert.equal(renderToStaticMarkup(React.createElement(ContactCard, { darkMode: false, contact: { authors: [], email: '', repoUrl: '' } })), '');
});
