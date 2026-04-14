import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

interface ApiParameter {
  Name: string;
  Type: { Name: string };
}

interface ApiMember {
  MemberType: 'Function' | 'Event' | 'Property' | 'Callback';
  Name: string;
  Parameters?: ApiParameter[];
  Security?: string | { Read?: string; Write?: string };
}

interface ApiClass {
  Name: string;
  Superclass: string;
  Members: ApiMember[];
}

interface ApiDump {
  Classes: ApiClass[];
}

function isSecurityNone(security: ApiMember['Security']): boolean {
  if (!security) return true;
  if (typeof security === 'string') return security === 'None';
  return (security.Read === 'None' || !security.Read) &&
         (security.Write === 'None' || !security.Write);
}

let classMap: Map<string, ApiClass> | undefined;

function loadDump(): Map<string, ApiClass> | undefined {
  if (classMap) return classMap;

  const ext = vscode.extensions.getExtension('nightrains.robloxlsp');
  if (!ext) return undefined;

  const dumpPath = path.join(ext.extensionPath, 'server', 'api', 'API-Dump.json');
  try {
    const raw = fs.readFileSync(dumpPath, 'utf8');
    const dump: ApiDump = JSON.parse(raw);
    classMap = new Map(dump.Classes.map(c => [c.Name, c]));
    return classMap;
  } catch {
    return undefined;
  }
}

function formatSignature(member: ApiMember): string {
  const params = (member.Parameters ?? [])
    .map(p => `${p.Name}: ${p.Type?.Name ?? 'any'}`)
    .join(', ');
  return `(${params})`;
}

export function getMembersForClass(className: string): vscode.CompletionItem[] {
  const map = loadDump();
  if (!map) return [];

  const items: vscode.CompletionItem[] = [];
  const seen = new Set<string>();

  let current: string | undefined = className;
  while (current && current !== '<<<ROOT>>>') {
    const cls = map.get(current);
    if (!cls) break;

    for (const member of cls.Members) {
      if (seen.has(member.Name)) continue;
      if (!isSecurityNone(member.Security)) continue;
      seen.add(member.Name);

      if (member.MemberType === 'Function') {
        const sig = formatSignature(member);
        const item = new vscode.CompletionItem(member.Name, vscode.CompletionItemKind.Method);
        item.detail = `${className}:${member.Name}${sig}`;
        item.documentation = new vscode.MarkdownString(
          `**${member.Name}**${sig} — \`${cls.Name}\``
        );
        item.insertText = new vscode.SnippetString(`${member.Name}(${
          (member.Parameters ?? [])
            .map((p, i) => `\${${i + 1}:${p.Name}}`)
            .join(', ')
        })`);
        item.sortText = `a~${member.Name.toLowerCase()}`;
        items.push(item);

      } else if (member.MemberType === 'Event') {
        const item = new vscode.CompletionItem(member.Name, vscode.CompletionItemKind.Event);
        item.detail = `${className}.${member.Name} (Event)`;
        item.documentation = new vscode.MarkdownString(
          `**${member.Name}** (Event) — \`${cls.Name}\``
        );
        item.insertText = member.Name;
        item.sortText = `b~${member.Name.toLowerCase()}`;
        items.push(item);

      } else if (member.MemberType === 'Property') {
        const item = new vscode.CompletionItem(member.Name, vscode.CompletionItemKind.Property);
        item.detail = `${className}.${member.Name} (Property)`;
        item.insertText = member.Name;
        item.sortText = `c~${member.Name.toLowerCase()}`;
        items.push(item);

      } else if (member.MemberType === 'Callback') {
        const item = new vscode.CompletionItem(member.Name, vscode.CompletionItemKind.Function);
        item.detail = `${className}.${member.Name} (Callback)`;
        item.insertText = member.Name;
        item.sortText = `b~${member.Name.toLowerCase()}`;
        items.push(item);
      }
    }

    current = cls.Superclass;
  }

  return items;
}
