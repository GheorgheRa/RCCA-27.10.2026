import { backend } from '@/api/backendClient';

const cache = new Map();

async function fetchPicklist(category) {
  if (cache.has(category)) return cache.get(category);
  const options = await backend.entities.PicklistOption.filter(
    { category, is_active: true },
    'sort_order',
    500
  );
  const result = options
    .filter(option => option.value != null && option.value !== '')
    .map(option => ({ value: option.value, label: option.label }));
  cache.set(category, result);
  return result;
}

export const fetchIssueTypes = () => fetchPicklist('IssueType_Picklist');
export const fetchProcessSteps = () => fetchPicklist('ProcessStep_Picklist');
export const fetchAssignDpt = () => fetchPicklist('department');
export const fetchDefectTypes = () => fetchPicklist('DefectType_Picklist');

export async function fetchPartNumberAlias() {
  const category = 'Part Number vs Alias_Picklist';
  if (cache.has(category)) return cache.get(category);
  const options = await backend.entities.PicklistOption.filter(
    { category, is_active: true },
    'sort_order',
    500
  );
  const result = options.map(option => ({ partNumber: option.value, alias: option.label }));
  cache.set(category, result);
  return result;
}

export async function fetchUtilajSerial() {
  const category = 'Utilaj - Serial#_Picklist';
  if (cache.has(category)) return cache.get(category);
  const options = await backend.entities.PicklistOption.filter(
    { category, is_active: true },
    'sort_order',
    500
  );
  const result = options.map(option => ({ partNumber: option.value, alias: option.label }));
  cache.set(category, result);
  return result;
}
