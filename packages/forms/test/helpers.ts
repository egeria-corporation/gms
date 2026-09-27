// SPDX-License-Identifier: AGPL-3.0-only
import type { FormModelInput } from '../src';

/** A form that uses every field type once. */
export const ALL_TYPES: FormModelInput = {
  version: 1,
  title: 'Every field type',
  pages: [
    {
      id: 'p1',
      title: 'Basics',
      elements: [
        { type: 'info_block', id: 'intro', markdown: 'Welcome! **Take your time.**' },
        { id: 't', type: 'text', label: 'Text', maxLength: 10 },
        { id: 'lt', type: 'long_text', label: 'Long text', maxWords: 5 },
        { id: 'rt', type: 'rich_text', label: 'Rich text', maxWords: 5 },
        { id: 'n', type: 'number', label: 'Number', min: 0, max: 10 },
        { id: 'cur', type: 'currency', label: 'Amount', min: 100, max: 100_000 },
        { id: 'd', type: 'date', label: 'Date', min: '2027-01-01', max: '2027-12-31' },
        { id: 's', type: 'select', label: 'Select', options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] },
        { id: 'ms', type: 'multi_select', label: 'Multi', options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }], maxSelections: 1 },
        { id: 'cg', type: 'checkbox_group', label: 'Checks', options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] },
        { id: 'yn', type: 'yes_no', label: 'Yes or no' },
      ],
    },
    {
      id: 'p2',
      title: 'People',
      elements: [
        {
          type: 'section',
          id: 'contact_section',
          title: 'Contact',
          elements: [
            { id: 'nm', type: 'name', label: 'Name', required: true },
            { id: 'addr', type: 'address', label: 'Address', required: true },
            { id: 'em', type: 'email', label: 'Email' },
            { id: 'ph', type: 'phone', label: 'Phone' },
          ],
        },
        { id: 'ein', type: 'ein', label: 'EIN' },
        { id: 'uei', type: 'uei', label: 'UEI' },
      ],
    },
    {
      id: 'p3',
      title: 'More',
      elements: [
        { id: 'files', type: 'file_upload', label: 'Files', accept: ['pdf'], maxBytes: 1000, multiple: true, maxFiles: 2, help: 'PDFs' },
        {
          id: 'rows',
          type: 'repeater_table',
          label: 'Rows',
          help: 'Add rows',
          maxRows: 2,
          columns: [
            { id: 'what', type: 'text', label: 'What', required: true },
            { id: 'qty', type: 'number', label: 'Qty' },
            { id: 'cost', type: 'currency', label: 'Cost', required: true },
          ],
        },
        {
          id: 'lik',
          type: 'likert_matrix',
          label: 'Ratings',
          help: 'Rate each',
          required: true,
          rows: [
            { id: 'r1', label: 'Row one' },
            { id: 'r2', label: 'Row two' },
          ],
          scale: [
            { value: '1', label: 'Low' },
            { value: '2', label: 'High' },
          ],
        },
        { id: 'att', type: 'attestation', label: 'Sign', statement: 'It is true.', required: true },
      ],
    },
  ],
};
