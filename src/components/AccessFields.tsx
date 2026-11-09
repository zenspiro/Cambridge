// The access a team member gets (owner, 9 Nov 2026), for the invite form and each member's edit form: None, View or
// Edit per area, and the subjects (every subject, or a multi-select of ticks by qualification). No server or client
// APIs; plain form fields.
import { AREAS, AREA_WORDS, LEVEL_WORDS, type Access, type Level } from "@/lib/auth/team";
import type { SubjectOption } from "@/lib/library/catalog";

export function AccessFields({ subjects, value, idPrefix }: { subjects: SubjectOption[]; value: Access; idPrefix: string }) {
  const quals = [...new Set(subjects.map((s) => s.qualification))];
  const all = value.subjects === "all";
  return (
    <div className="access-fields">
      <div className="access-areas">
        {AREAS.map((a) => (
          <label className="field" key={a}>
            <span className="label-inline">{AREA_WORDS[a].name}</span>
            <select className="input" name={a} defaultValue={value[a]} aria-describedby={`${idPrefix}-${a}-hint`}>
              {(["none", "view", "edit"] as Level[]).map((l) => <option key={l} value={l}>{LEVEL_WORDS[l]}</option>)}
            </select>
            <span className="hint" id={`${idPrefix}-${a}-hint`}>{AREA_WORDS[a].what}</span>
          </label>
        ))}
      </div>
      <fieldset className="fieldset access-subjects">
        <legend className="label-inline">Subjects</legend>
        <label className="check"><input type="checkbox" name="allSubjects" value="1" defaultChecked={all} /> Every subject (also new ones)</label>
        <p className="hint m-0">Or tick the subjects this person may work on:</p>
        {quals.map((q) => (
          <div className="access-qual" key={q}>
            <span className="label-inline">{q}</span>
            <div className="checks">
              {subjects.filter((s) => s.qualification === q).map((s) => (
                <label className="check" key={s.code}>
                  <input type="checkbox" name="subject" value={s.code} defaultChecked={!all && value.subjects.includes(s.code)} /> {s.label.replace(`${q} `, "")}
                </label>
              ))}
            </div>
          </div>
        ))}
      </fieldset>
    </div>
  );
}
