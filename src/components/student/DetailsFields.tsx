// Country and birth year fields, shared by the welcome step, the details form and the profile page.
// `studentNote`: the birth year is hidden by CSS when "I'm a parent" is picked (no script needed).

export function DetailsFields({
  countries,
  years,
  country,
  birthYear,
  studentNote,
  lockedYear,
}: {
  countries: { code: string; name: string }[];
  years: number[] | null;
  country: string | null;
  birthYear: number | null;
  studentNote?: boolean;
  lockedYear?: boolean;
}) {
  return (
    <>
      <label className="s-field">
        <span className="s-label">Country</span>
        <select className="s-input" name="country" required defaultValue={country ?? ""}>
          <option value="" disabled>Choose your country</option>
          {countries.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
        </select>
      </label>
      {years ? (
        <label className={studentNote ? "s-field s-student-only" : "s-field"}>
          <span className="s-label">Birth year{studentNote ? " (students)" : ""}</span>
          {lockedYear ? (
            <span className="s-muted">{birthYear} (approved by a parent, so it cannot be changed here)</span>
          ) : (
            <select className="s-input" name="birthYear" defaultValue={birthYear ?? ""}>
              <option value="" disabled>Choose your birth year</option>
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          )}
        </label>
      ) : null}
    </>
  );
}
