import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { TreeNode } from './wsClient';

const PROJECT_FILE_NAME = 'rotellisense-live.project.json';

function treeNodeToRojoTree(node: TreeNode): Record<string, unknown> {
  const obj: Record<string, unknown> = { '$className': node.className };
  const children = Array.isArray(node.children) ? node.children as TreeNode[] : [];
  for (const child of children) {
    if (!child.name) continue;
    // Skip names that would break Rojo project.json as keys (reserved $-prefix keys)
    if (child.name.startsWith('$')) continue;
    obj[child.name] = treeNodeToRojoTree(child);
  }
  return obj;
}

export function generateProjectJson(tree: TreeNode): string {
  return JSON.stringify(
    { name: 'rotellisense-live', tree: treeNodeToRojoTree(tree) },
    null,
    2
  );
}

export function writeProjectFiles(tree: TreeNode): string[] {
  const json = generateProjectJson(tree);
  const written: string[] = [];

  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    const filePath = path.join(folder.uri.fsPath, PROJECT_FILE_NAME);
    try {
      fs.writeFileSync(filePath, json, 'utf8');
      written.push(filePath);
    } catch {
      // Non-writable workspace; silently skip
    }
  }

  return written;
}

export function deleteProjectFiles(): void {
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    const filePath = path.join(folder.uri.fsPath, PROJECT_FILE_NAME);
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch {
      // Ignore
    }
  }
}

export function ensureGitignore(): void {
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    const gitignorePath = path.join(folder.uri.fsPath, '.gitignore');
    try {
      let contents = '';
      if (fs.existsSync(gitignorePath)) {
        contents = fs.readFileSync(gitignorePath, 'utf8');
      }
      if (!contents.includes(PROJECT_FILE_NAME)) {
        const entry = `\n# Rotellisense live type project (auto-generated)\n${PROJECT_FILE_NAME}\n`;
        fs.appendFileSync(gitignorePath, entry, 'utf8');
      }
    } catch {
      // Ignore non-writable workspace
    }
  }
}
