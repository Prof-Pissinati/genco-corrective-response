# Origin of the code in this folder

Base: the author's power systems simulator (React + Vite), copied on 2026-10-08 (source commit **e13d986**) and adapted for
transmission. On 2026-10-12 the modules specific to distribution networks were removed (importers, optimizers, sequencer,
distribution solver and the example systems): this folder keeps only what the transmission analysis uses (diagram, import of cases
in MATPOWER format, map, corrective response panels, screening and reconnection, and the local DC solver).
