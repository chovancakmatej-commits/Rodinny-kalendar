# Rodinný kalendár

Rodinný kalendár na tablet (Samsung Galaxy Tab S9 FE, na šírku): aktuálny týždeň, udalosti dňa, to-do list a slideshow s mesačným kalendárom po nečinnosti.

Beží ako webová aplikácia na GitHub Pages: https://chovancakmatej-commits.github.io/Rodinny-kalendar/
Na tablete ju otvor v Chrome a pridaj cez ⋮ › „Pridať na plochu“.

## Ako sa načítava kalendár

GitHub Actions (`.github/workflows/kalendar.yml`) každých 15 minút stiahne kalendáre z tajných iCal adries,
rozbalí opakované udalosti a zašifruje ich heslom do `data.enc.json`. Aplikácia ich na tablete odomkne heslom.
Adresy ani udalosti nie sú v repozitári.

Nastavenie v **Settings › Secrets and variables › Actions**:

- `CALENDARS` – jeden kalendár na riadok: `<osoba> <tajná iCal adresa>`, osoba = `praca`, `mato`, `manzelka` alebo `spolocne`
- `CALENDAR_PASSWORD` – heslo, ktoré zadáš na tablete

Udalosť, ktorej názov začína `!`, sa zobrazí ako dôležitá.
