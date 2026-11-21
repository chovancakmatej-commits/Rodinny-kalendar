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

## Presné spúšťanie každých 15 minút (cron-job.org)

GitHub plánované behy (`schedule`) často oneskoruje, reálne bežia raz za 45–70 minút. Presnejšie ich spúšťa bezplatná služba cron-job.org:

1. **Token na GitHube:** Settings › Developer settings › Personal access tokens › Fine-grained tokens › *Generate new token*.
   Repository access: *Only select repositories* › `Rodinny-kalendar`. Permissions › Repository › **Actions: Read and write**. Platnosť napr. 1 rok. Token skopíruj.
2. **cron-job.org:** zaregistruj sa, *Create cronjob*:
   - URL: `https://api.github.com/repos/chovancakmatej-commits/Rodinny-kalendar/actions/workflows/kalendar.yml/dispatches`
   - Execution schedule: *Every 15 minutes*
   - Advanced › Request method: **POST**
   - Advanced › Headers: `Authorization: Bearer <token>`, `Accept: application/vnd.github+json`, `X-GitHub-Api-Version: 2022-11-28`
   - Advanced › Request body: `{"ref":"main"}`
   - *Test run* má vrátiť stav **204**.

Plánovaný beh v GitHube ostáva ako záloha. Keď token vyprší, cron-job.org začne hlásiť chybu 401, stačí vytvoriť nový token a vymeniť ho v hlavičke.
