/**
 * The group mark (ADR-0025, approved direction D): a folder body with two
 * sheet edges fanned above it. Everything stays inside the mark's box, so a
 * group can never bleed into a neighbouring cover or the title. The count is
 * the only text.
 */
interface GroupMarkProps {
  count: number;
  size?: 'thumb' | 'cover' | 'header';
  /** Small unit line under the count; used at cover size. */
  unit?: string;
}

export const GroupMark = ({ count, size = 'thumb', unit }: GroupMarkProps) => (
  <span className={`group-mark is-${size}`} aria-hidden="true">
    <span className="group-mark-sheet is-back" />
    <span className="group-mark-sheet is-mid" />
    <span className="group-mark-tab" />
    <span className="group-mark-body">
      <span className="group-mark-num">{count}</span>
      {size === 'cover' && unit ? <span className="group-mark-unit">{unit}</span> : null}
    </span>
  </span>
);
