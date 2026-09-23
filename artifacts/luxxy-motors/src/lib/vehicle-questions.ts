export const vehicleQuestions: Record<string, { label: string; message: string }> = {
  service: { label: 'Service history', message: 'Could you confirm the service history and available records for this car?' },
  mot: { label: 'MOT expiry', message: 'Could you confirm the MOT expiry date and any advisories for this car?' },
  keys: { label: 'Keys', message: 'How many keys are supplied with this car?' },
  history: { label: 'Insurance history', message: 'Could you confirm the recorded insurance history and available inspection records for this car?' },
  condition: { label: 'Condition', message: 'Could you tell me about the condition and any known faults on this car?' },
  warranty: { label: 'Warranty', message: 'What warranty options and terms are available for this car?' },
  included: { label: 'Included with this car', message: 'Could you confirm which documents and accessories come with this car?' },
};
export function questionKeyForLabel(label: string) {
  return Object.keys(vehicleQuestions).find(key => vehicleQuestions[key].label === label);
}
export function questionMessage(key: string | null) {
  return key && Object.prototype.hasOwnProperty.call(vehicleQuestions, key) ? vehicleQuestions[key].message : '';
}
