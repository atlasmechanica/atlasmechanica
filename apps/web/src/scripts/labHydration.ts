import { loadMechanismLab, type LabPresentationSelection } from '@atlasmechanica/lab/lazy-runtime';

/** Only reads this component's attributes. No document-global selection or registry. */
type LabElement = Pick<Element, 'getAttribute'>;
function requiredAttribute(root: LabElement, name: string): string {
  const value = root.getAttribute(name);
  if (value === null || value.trim() === '') throw new TypeError(`Mechanism lab requires ${name}`);
  return value;
}

/**
 * An absent payload is the legacy registered-lab path. A present but invalid
 * payload is an error, never permission to render a different default lab.
 * The public lazy resolver remains the full template/physics-binding validator.
 */
export async function loadElementMechanismLab(root: LabElement) {
  const modelId = requiredAttribute(root, 'data-model-id');
  const adapterId = requiredAttribute(root, 'data-adapter-id');
  const labId = requiredAttribute(root, 'data-lab-id');
  const text = root.getAttribute('data-lab-presentation');
  let selection: string | LabPresentationSelection = labId;
  if (text !== null) {
    let parsed: unknown;
    try { parsed = JSON.parse(text); }
    catch (cause) { throw new TypeError('Invalid serialized lab presentation JSON', { cause }); }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)
      || !Object.hasOwn(parsed, 'templateLabId') || !Object.hasOwn(parsed, 'definition')) {
      throw new TypeError('Serialized lab presentation requires a template and definition');
    }
    selection = parsed as LabPresentationSelection;
  }
  const resolved = await loadMechanismLab(modelId, adapterId, selection);
  if (resolved.definition.id !== labId) {
    throw new TypeError('Serialized lab presentation does not match this component lab id');
  }
  return resolved;
}
