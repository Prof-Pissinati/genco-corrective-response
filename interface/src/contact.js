// src/contact.js
// Who developed it and how to reach the team. It is the ONLY place to edit: the "Developed by" card of the interface shows only what is filled in.
// Each author has a name, affiliations (one per line) and e-mail; `email` (team) and `repoUrl` (public repository, once published) are optional.

const UTAD = 'School of Science and Technology, University of Trás-os-Montes and Alto Douro (UTAD), Vila Real, Portugal';

export const CONTACT = {
    heading: 'Developed by',
    poweredBy: 'Powered by',           // text of the small label always visible in the corner of the diagram (before the names)
    authors: [
        {
            name: 'Rafael Pissinati de Souza',
            affiliations: [UTAD, 'Unesp – Ilha Solteira, LAPSE laboratory', 'IFRO – Porto Velho Calama, Control and Automation Engineering'],
            email: 'rafael.pissinati@ifro.edu.br',
        },
        {
            name: 'Leonardo Pilarski',
            affiliations: [UTAD, 'HumanISE, INESC TEC, UTAD Pole, Vila Real, Portugal'],
            email: 'pilarski@utad.pt',
        },
    ],
    email: '',
    repoUrl: '',
    event: 'GENCO Challenge · GridFM Porto 2026',
    credit: 'Uses GENCO and OpenGridFM (IBM Research and collaborators; Apache 2.0).',
};

/** Card lines from the configuration, without the empty fields: { authors: [{name, affiliations, email}], links: [{label, href, kind}] }. */
export function contactLines(c = CONTACT) {
    const authors = (c.authors || []).filter(a => a && a.name && a.name.trim()).map(a => ({
        name: a.name.trim(),
        affiliations: (a.affiliations || []).map(x => (x || '').trim()).filter(Boolean),
        email: (a.email || '').trim(),
    }));
    const links = [];
    const vistos = new Set();
    [...authors.map(a => a.email), (c.email || '').trim()].filter(Boolean).forEach(e => {
        if (!vistos.has(e.toLowerCase())) { vistos.add(e.toLowerCase()); links.push({ label: e, href: `mailto:${e}`, kind: 'email' }); }
    });
    if ((c.repoUrl || '').trim()) links.push({ label: 'Code on GitHub', href: c.repoUrl.trim(), kind: 'repo' });
    return { authors, links };
}

/** "Rafael X and Leonardo Z": names only, with "and" before the last one. */
export function authorsText(authors) {
    const parts = authors.map(a => a.name);
    if (parts.length <= 1) return parts.join('');
    return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}
