"""Builds the "Save to ReadWell" Apple Shortcut (unsigned) for the iPhone and iPad Share Sheet.

The file holds no secrets: Shortcuts asks for the capture key, Client ID and Client secret
when it is imported (import questions). Sign it on the Mac before importing:
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

    def secret_text(prompt):
        u = new_id()
        questions.append({'ActionIndex': len(actions), 'Category': 'Parameter', 'DefaultValue': '',
                          'ParameterKey': 'WFTextActionText', 'Text': prompt})
        actions.append(act('is.workflow.actions.gettext', UUID=u, WFTextActionText=''))
        return output(u, 'Text')

    key = secret_text('Paste your ReadWell capture key (1Password: “ReadWell capture key”).')
    client_id = secret_text('Paste the Client ID (1Password: “ReadWell capture token”). It ends in .access')
    client_secret = secret_text('Paste the Client secret (1Password: “ReadWell capture token”).')

    # Whatever the app shares (a web page, a link, or text containing a link): find the first link.
    links = new_id()
    actions.append(act('is.workflow.actions.detect.link', UUID=links, WFInput=attachment({'Type': 'ExtensionInput'})))
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
                       WFNotificationActionBody=text('No link found to save.'), WFNotificationActionSound=False))
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
        'WFWorkflowImportQuestions': questions,
        'WFWorkflowActions': actions,
    }


if __name__ == '__main__':
    workflow = build()
    with open(sys.argv[1], 'wb') as f:
        plistlib.dump(workflow, f, fmt=plistlib.FMT_BINARY)
    print(f'{len(workflow["WFWorkflowActions"])} actions, {len(workflow["WFWorkflowImportQuestions"])} import questions')
