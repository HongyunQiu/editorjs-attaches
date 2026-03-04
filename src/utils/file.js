/**
 * Return an extension by passed file name
 *
 * @param {string|undefined} name  - file name to process
 * @returns {string}
 */
export function getExtensionFromFileName(name) {
  if (typeof name !== 'string') {
    return '';
  }

  const trimmed = name.trim();
  if (!trimmed) return '';

  const lastDot = trimmed.lastIndexOf('.');

  /**
   * No dot, dot is first char (".gitignore"), or dot is the last char ("file.")
   */
  if (lastDot <= 0 || lastDot === trimmed.length - 1) {
    return '';
  }

  return trimmed.slice(lastDot + 1);
}
