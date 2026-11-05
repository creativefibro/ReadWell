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
        # Pasted values often carry a trailing line break; trim it before it reaches a header.
        t = new_id()
        actions.append(act('is.workflow.actions.text.trimwhitespace', UUID=t, WFInput=attachment(output(u, 'Text'))))
        return output(t, 'Updated Text')

    key = secret_text('Paste your ReadWell capture key in the box below (1Password: “ReadWell capture key”).', 'PASTE-CAPTURE-KEY')
    client_id = secret_text('Paste the Client ID below (1Password: “ReadWell capture token”). It ends in .access', 'PASTE-CLIENT-ID')
    client_secret = secret_text('Paste the Client secret below (1Password: “ReadWell capture token”).', 'PASTE-CLIENT-SECRET')

    # Look for a link in what was shared, then in the clipboard (Medium's "Share via…" shares only a
    # picture card, so Susan taps Copy link first). One text holds both, shared item first, so a
    # shared link always wins; then take the first link found.
    clip = new_id()
    actions.append(act('is.workflow.actions.getclipboard', UUID=clip))
    both = new_id()
    actions.append(act('is.workflow.actions.gettext', UUID=both,
                       WFTextActionText=text({'Type': 'ExtensionInput'}, '\n', output(clip, 'Clipboard'))))
    links = new_id()
    actions.append(act('is.workflow.actions.detect.link', UUID=links, WFInput=attachment(output(both, 'Text'))))
    first = new_id()
    actions.append(act('is.workflow.actions.getitemfromlist', UUID=first, WFItemSpecifier='First Item',
                       WFInput=attachment(output(links, 'URLs'))))
    link = output(first, 'Item from List')

    has_link = new_id()
    actions.append(act('is.workflow.actions.conditional', GroupingIdentifier=has_link, WFControlFlowMode=0,
                       WFCondition=100, WFInput={'Type': 'Variable', 'Variable': attachment(link)}))

    fetched = new_id()
    actions.append(act('is.workflow.actions.downloadurl', UUID=fetched, WFURL=ENDPOINT, WFHTTPMethod='POST',
                       ShowHeaders=True, WFHTTPBodyType='JSON',
                       WFJSONValues=dictionary([('url', text(link)), ('source', text('shortcut'))]),
                       WFHTTPHeaders=dictionary([('X-ReadWell-Key', text(key)),
                                                 ('CF-Access-Client-Id', text(client_id)),
                                                 ('CF-Access-Client-Secret', text(client_secret))])))
    message = new_id()
    actions.append(act('is.workflow.actions.getvalueforkey', UUID=message, WFGetDictionaryValueType='Value',
                       WFDictionaryKey='message', WFInput=attachment(output(fetched, 'Contents of URL'))))

    saved = new_id()
    actions.append(act('is.workflow.actions.conditional', GroupingIdentifier=saved, WFControlFlowMode=0,
                       WFCondition=100, WFInput={'Type': 'Variable', 'Variable': attachment(output(message, 'Dictionary Value'))}))
    actions.append(act('is.workflow.actions.notification', WFNotificationActionTitle='ReadWell',
                       WFNotificationActionBody=text(output(message, 'Dictionary Value')), WFNotificationActionSound=False))
    actions.append(act('is.workflow.actions.conditional', GroupingIdentifier=saved, WFControlFlowMode=1))
    problem = new_id()
    actions.append(act('is.workflow.actions.getvalueforkey', UUID=problem, WFGetDictionaryValueType='Value',
                       WFDictionaryKey='error', WFInput=attachment(output(fetched, 'Contents of URL'))))
    actions.append(act('is.workflow.actions.notification', WFNotificationActionTitle='ReadWell',
                       WFNotificationActionBody=text('Couldn’t save this. Is your Mac Studio on? ', output(problem, 'Dictionary Value')),
                       WFNotificationActionSound=False))
    actions.append(act('is.workflow.actions.conditional', GroupingIdentifier=saved, WFControlFlowMode=2))

    actions.append(act('is.workflow.actions.conditional', GroupingIdentifier=has_link, WFControlFlowMode=1))
    actions.append(act('is.workflow.actions.notification', WFNotificationActionTitle='ReadWell',
                       WFNotificationActionBody=text('No link found. In Medium, tap Copy link first, then Share via… › Save to ReadWell. Saw: ', output(both, 'Text')),
                       WFNotificationActionSound=False))
    actions.append(act('is.workflow.actions.conditional', GroupingIdentifier=has_link, WFControlFlowMode=2))

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
