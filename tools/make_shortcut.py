"""Builds the "Save to ReadWell" Apple Shortcut (unsigned) for the iPhone and iPad Share Sheet.

The file holds no secrets: after importing, paste the capture key, Client ID and Client secret
into the three labelled Text boxes in the Shortcuts editor. Sign it on the Mac before importing:
    shortcuts sign --mode anyone --input "Save to ReadWell (unsigned).shortcut" --output "Save to ReadWell.shortcut"

Usage: python3 tools/make_shortcut.py OUTPUT_PATH
"""
import plistlib, sys, uuid

ENDPOINT = 'https://readwell.susanpearson.uk/api/capture'
OBJ = '￼'  # placeholder character where a variable sits inside text


def new_id():
    return str(uuid.uuid4()).upper()


def output(action_uuid, name):
    return {'Type': 'ActionOutput', 'OutputUUID': action_uuid, 'OutputName': name}


def attachment(value):
    """A parameter that is a single variable."""
    return {'Value': value, 'WFSerializationType': 'WFTextTokenAttachment'}


def text(*parts):
    """Text mixing plain strings and variables (dicts from output() or extension input)."""
    string, attachments = '', {}
    for part in parts:
        if isinstance(part, str):
            string += part
        else:
            # Ranges count UTF-16 code units, as Shortcuts does.
            pos = len(string.encode('utf-16-le')) // 2
            attachments['{%d, 1}' % pos] = part
            string += OBJ
    return {'Value': {'string': string, 'attachmentsByRange': attachments}, 'WFSerializationType': 'WFTextTokenString'}


def dictionary(pairs):
    return {'Value': {'WFDictionaryFieldValueItems': [
        {'WFItemType': 0, 'WFKey': text(k), 'WFValue': v} for k, v in pairs]},
        'WFSerializationType': 'WFDictionaryFieldValue'}


def condition(group, var, code):
    """Start of an If block. Writes the current format (WFConditions, used since iOS 16) and the
    older WFInput/WFCondition pair; iOS 27 ignored the older pair alone, so every test failed.
    Codes: 100 = has any value, 101 = does not have any value."""
    test = {'WFCondition': code, 'WFInput': {'Type': 'Variable', 'Variable': attachment(var)}}
    return act('is.workflow.actions.conditional', GroupingIdentifier=group, WFControlFlowMode=0,
               WFCondition=code, WFInput=test['WFInput'],
               WFConditions={'Value': {'WFActionParameterFilterPrefix': 1, 'WFActionParameterFilterTemplates': [test]},
                             'WFSerializationType': 'WFContentPredicateTableTemplate'})


def act(identifier, **params):
    return {'WFWorkflowActionIdentifier': identifier, 'WFWorkflowActionParameters': params}


def build():
    actions, questions = [], []

    # Three labelled boxes Susan fills in once, in the Shortcuts editor. (Import questions
    # were tried first; the macOS import sheet refused the pasted values.)
    def secret_text(label, placeholder):
        actions.append(act('is.workflow.actions.comment', WFCommentActionText=label))
        u = new_id()
        actions.append(act('is.workflow.actions.gettext', UUID=u, WFTextActionText=text(placeholder)))
        # Pasted values often carry a trailing line break; strip whitespace at either end with the
        # standard Replace Text action (an earlier "trim" identifier was not a real action and
        # passed on nothing, so the Shortcut sent empty credentials).
        t = new_id()
        actions.append(act('is.workflow.actions.text.replace', UUID=t, WFInput=text(output(u, 'Text')),
                           WFReplaceTextFind='^\\s+|\\s+$', WFReplaceTextReplace='',
                           WFReplaceTextRegularExpression=True, WFReplaceTextCaseSensitive=False))
        return output(t, 'Updated Text')

    key = secret_text('Paste your ReadWell capture key in the box below (1Password: “ReadWell capture key”).', 'PASTE-CAPTURE-KEY')
    client_id = secret_text('Paste the Client ID below (1Password: “ReadWell capture token”). It ends in .access', 'PASTE-CLIENT-ID')
    client_secret = secret_text('Paste the Client secret below (1Password: “ReadWell capture token”).', 'PASTE-CLIENT-SECRET')

    # Send everything: what was shared, then the clipboard (Medium's "Share via…" shares only a
    # picture card, so Susan taps Copy link first). ReadWell finds the first link and replies with
    # a "notice" to show. No If blocks: iOS 27 ignored their conditions, so the Shortcut is linear.
    clip = new_id()
    actions.append(act('is.workflow.actions.getclipboard', UUID=clip))
    both = new_id()
    actions.append(act('is.workflow.actions.gettext', UUID=both,
                       WFTextActionText=text({'Type': 'ExtensionInput'}, '\n', output(clip, 'Clipboard'))))
    fetched = new_id()
    actions.append(act('is.workflow.actions.downloadurl', UUID=fetched, WFURL=ENDPOINT, WFHTTPMethod='POST',
                       ShowHeaders=True, WFHTTPBodyType='JSON',
                       WFJSONValues=dictionary([('text', text(output(both, 'Text'))), ('source', text('shortcut'))]),
                       WFHTTPHeaders=dictionary([('X-ReadWell-Key', text(key)),
                                                 ('CF-Access-Client-Id', text(client_id)),
                                                 ('CF-Access-Client-Secret', text(client_secret))])))
    notice = new_id()
    actions.append(act('is.workflow.actions.getvalueforkey', UUID=notice, WFGetDictionaryValueType='Value',
                       WFDictionaryKey='notice', WFInput=attachment(output(fetched, 'Contents of URL'))))
    actions.append(act('is.workflow.actions.notification', WFNotificationActionTitle='ReadWell',
                       WFNotificationActionBody=text(output(notice, 'Dictionary Value')), WFNotificationActionSound=False))

    return {
        'WFWorkflowClientVersion': '2607.0.2',
        'WFWorkflowMinimumClientVersion': 900,
        'WFWorkflowMinimumClientVersionString': '900',
        'WFWorkflowIcon': {'WFWorkflowIconStartColor': 2071128575, 'WFWorkflowIconGlyphNumber': 59511},
        'WFWorkflowTypes': ['ActionExtension'],
        'WFWorkflowInputContentItemClasses': ['WFURLContentItem', 'WFSafariWebPageContentItem', 'WFStringContentItem',
                                              'WFRichTextContentItem', 'WFArticleContentItem'],
        'WFWorkflowHasShortcutInputVariables': True,
        'WFWorkflowNoInputBehavior': {'Name': 'WFWorkflowNoInputBehaviorGetClipboard', 'Parameters': {}},
        'WFWorkflowOutputContentItemClasses': [],
        'WFWorkflowHasOutputFallback': False,
        'WFQuickActionSurfaces': [],
        'WFWorkflowImportQuestions': [],
        'WFWorkflowActions': actions,
    }


if __name__ == '__main__':
    workflow = build()
    with open(sys.argv[1], 'wb') as f:
        plistlib.dump(workflow, f, fmt=plistlib.FMT_BINARY)
    print(f'{len(workflow["WFWorkflowActions"])} actions')
