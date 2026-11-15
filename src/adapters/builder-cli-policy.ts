import { isAbsolute, resolve, parse } from 'node:path';

/**
 * Host-side policy for the pinned subscription CLI. The sole execution tool is
 * a trusted MCP bridge; its implementation owns the independent VM boundary.
 * The caller must use an empty trusted cwd outside the candidate and pass
 * --ignore-user-config, --strict-config, --ignore-rules and --ephemeral.
 * Authentication remains the responsibility of subscriptionEnvironment.
 */
export function builderCliPolicy(mcpCommand: string, mcpArgs: readonly string[], cwd: string): string[] {
  if (!isAbsolute(mcpCommand) || !isAbsolute(cwd) || resolve(cwd) !== cwd || parse(cwd).root === cwd || [mcpCommand, cwd, ...mcpArgs].some(v => /[\0\r\n]/.test(v))) {
    throw new Error('Builder CLI requires absolute trusted paths and single-line arguments');
  }
  const filesystem = `":root"="deny",":minimal"="read",":tmpdir"="deny",":slash_tmp"="deny",${JSON.stringify(cwd)}="read"`;
  const disabled = [
    'shell_tool', 'unified_exec', 'unified_exec_tty', 'incremental_exec_tools',
    'code_mode', 'code_mode_only', 'js_repl', 'js_repl_tools_only', 'view_image',
    'apps', 'apps_early_resource_discovery', 'enable_mcp_apps', 'plugins',
    'hooks', 'browser_use', 'browser_use_external', 'browser_use_full_cdp_access',
    'in_app_browser', 'computer_use', 'image_generation', 'multi_agent',
    'multi_agent_v2', 'multi_agent_v2_dynamic_tools', 'agent_message_board',
    'runtime_agent_instances', 'goals', 'memories', 'remote_plugin',
    'plugin_discovery_prefetch', 'shell_snapshot', 'shell_snapshot_v2',
    'unbounded_connection_retries', 'skill_mcp_dependency_install', 'skill_search',
    'workspace_dependencies', 'request_permissions_tool', 'exec_permission_approvals',
    'standalone_web_search', 'network_proxy',
  ];
  const settings = [
    'approval_policy="never"',
    'default_permissions="aegean-builder-tools"',
    `permissions={aegean-builder-tools={filesystem={${filesystem}},network={enabled=false}}}`,
    'web_search="disabled"',
    `mcp_servers={aegean_builder={command=${JSON.stringify(mcpCommand)},args=${JSON.stringify(mcpArgs)},required=true,enabled_tools=["execute"],tools={execute={approval_mode="approve"}}}}`,
    // agents.enabled owns the current collaboration switch; feature flags alone
    // do not disable catalog-provided collaboration. max_threads excludes root.
    'apps={}', 'agents.enabled=false', 'agents.max_threads=1', 'analytics.enabled=false', 'feedback.enabled=false',
    // The pinned CLI still loads global AGENTS.md independently of this limit.
    // Those trusted operator documents do not grant tools or filesystem access.
    'project_doc_max_bytes=0', 'skills.bundled.enabled=false', 'skills.include_instructions=false',
    'developer_instructions="You are the Builder inside an already approved Aegean run. Work from the explicit approved task contract. Execute candidate commands only through the aegean_builder execute tool. Do not recursively launch Aegean, enrol a project, create approvals, or change the coordinator."',
    ...disabled.map(feature => `features.${feature}=false`),
    'features.skip_host_skill_discovery=true', 'features.code_mode_host=true',
  ];
  return settings.flatMap(setting => ['-c', setting]);
}
