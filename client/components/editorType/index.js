import './style.scss';

/**
 * Editor type component
 * @param {object} props
 * @param {'all'|'ace'|'cm'} props.type
 */
export default function EditorType({ type }) {
  return <span className={`editor-type ${type}`} />;
}
