/**
 * Assembles a full iOS Shortcuts workflow (WFWorkflow) for the
 * Transparent Classroom sign-in/out automation and serializes it to a
 * binary plist (.shortcut file) using BPlistWriter.
 */
(function (global) {
  'use strict';

  const SCHOOL_URL = global.TCSignInConfig.SCHOOL_URL;

  const ICONS = {
    Dropoff: { color: 4274264319, glyph: 61440 }, // green
    Pickup: { color: 4284060143, glyph: 61440 } // orange
  };

  function uuid() {
    if (global.crypto && global.crypto.randomUUID) return global.crypto.randomUUID();
    // Fallback UUID v4 generator for older browsers.
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function buildWorkflow(options) {
    const pin = options.pin;
    const childName = options.childName;
    const mode = options.mode; // "Dropoff" or "Pickup"

    const script = global.ShortcutScriptBuilder.buildInjectedScript(pin, childName, mode);
    const icon = ICONS[mode] || ICONS.Dropoff;

    return {
      WFWorkflow: {
        WFWorkflowActions: [
          {
            WFWorkflowActionIdentifier: 'is.workflow.actions.openurl',
            WFWorkflowActionParameters: {
              WFInput: SCHOOL_URL,
              UUID: uuid()
            }
          },
          {
            WFWorkflowActionIdentifier: 'is.workflow.actions.runjavascriptonwebpage',
            WFWorkflowActionParameters: {
              WFJavaScript: script,
              UUID: uuid()
            }
          }
        ],
        WFWorkflowClientRelease: '18.0',
        WFWorkflowClientVersion: '1302.1.3',
        WFWorkflowMinimumClientVersion: 900,
        WFWorkflowMinimumClientVersionString: '900',
        WFWorkflowIcon: {
          WFWorkflowIconStartColor: icon.color,
          WFWorkflowIconGlyphNumber: icon.glyph
        },
        WFWorkflowTypes: [],
        WFWorkflowInputContentItemClasses: [
          'WFAppStoreAppContentItem',
          'WFArticleContentItem',
          'WFContactContentItem',
          'WFDateContentItem',
          'WFEmailAddressContentItem',
          'WFGenericFileContentItem',
          'WFImageContentItem',
          'WFLocationContentItem',
          'WFDCMapsLinkContentItem',
          'WFAVAssetContentItem',
          'WFPDFContentItem',
          'WFPhoneNumberContentItem',
          'WFRichTextContentItem',
          'WFSafariWebPageContentItem',
          'WFStringContentItem',
          'WFURLContentItem'
        ],
        WFWorkflowOutputContentItemClasses: [],
        WFWorkflowHasOutputFallback: false,
        WFWorkflowHasShortcutInputVariables: false,
        WFWorkflowImportQuestions: []
      }
    };
  }

  function buildShortcutFile(options) {
    const workflow = buildWorkflow(options);
    return global.BPlistWriter.createBinaryPlist(workflow);
  }

  global.ShortcutFileBuilder = { buildShortcutFile };
})(typeof window !== 'undefined' ? window : globalThis);
