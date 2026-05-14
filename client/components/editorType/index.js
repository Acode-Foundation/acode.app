import './style.scss';

/**
 * Editor type component
 * @param {object} props
 * @param {'all'|'ace'|'cm'} props.type
 * @param {string} [props.className]
 */
export default function EditorType({ type, className }) {
  return <span className={`editor-type ${type} ${className ? className : ''}`.trim()} />;
}
