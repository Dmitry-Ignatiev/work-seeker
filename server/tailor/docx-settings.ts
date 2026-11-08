import 'server-only';

/**
 * Word settings for every CV DOCX. `w:view print` makes Word open the file in Print Layout (the real page)
 * rather than Web Layout, where text runs the window's width and the right-side dates sit mid-screen.
 * Passed to `Packer.toBuffer` as an override of the settings file the docx library writes.
 */
export const DOCX_SETTINGS = [
  {
    path: 'word/settings.xml',
    data:
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      '<w:view w:val="print"/><w:zoom w:percent="100"/><w:defaultTabStop w:val="720"/>' +
      '<w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat>' +
      '</w:settings>',
  },
] as const;
