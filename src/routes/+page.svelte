<script lang="ts">
  import { onMount } from 'svelte';
  import { viamClient, getMachineConfig, findEventManagers, saveEventManager } from '../lib/index.js';
  import resourceMethods from '../lib/resource_methods.json' with { type: 'json' };

  console.log("Svelte component loaded, viamClient:", viamClient);

  interface Rule {
    type: 'detection' | 'classification' | 'tracker' | 'time' | 'call';
    camera?: string;
    detector?: string;
    classifier?: string;
    tracker?: string;
    class_regex?: string;
    confidence_pct?: number;
    ranges?: Array<{start_hour: number, end_hour: number}>;
    resource?: string;
    method?: string;
    payload?: string;
    result_path?: string;
    result_function?: string;
    result_operator?: string;
    result_value?: string;
    inverse_pause_secs?: number;
    pause_on_known_secs?: number;
    extra?: Record<string, any>;
  }

  interface Notification {
    type: 'sms' | 'email' | 'webhook_get' | 'push';
    preset?: string;
    to?: string[];
    include_image?: boolean;
    url?: string;
    fcm_tokens?: string[];
  }

  // Separate interface for the 'add notification' form to handle string inputs
  interface NewNotification {
    type: 'sms' | 'email' | 'webhook_get' | 'push';
    preset?: string;
    to?: string;
    include_image?: boolean;
    url?: string;
    fcm_tokens?: string;
  }

  interface Action {
    resource: string;
    method: string;
    payload: string;
    response_match?: string;
    when_secs: number;
  }

  interface EventConfig {
    name: string;
    pause_alerting_on_event_secs: number;
    backoff_schedule?: Record<string, number>;
    detection_hz: number;
    rule_logic_type: 'AND' | 'OR' | 'XOR' | 'NOR' | 'NAND' | 'XNOR';
    trigger_sequence_count: number;
    require_rule_reset: boolean;
    rule_reset_count: number;
    notifications: Notification[];
    actions: Action[];
    rules: Rule[];
    resources?: Record<string, {type: string, subtype: string}>;
  }

  let config: EventConfig = {
    name: '',
    pause_alerting_on_event_secs: 300,
    detection_hz: 5,
    rule_logic_type: 'AND',
    trigger_sequence_count: 1,
    require_rule_reset: false,
    rule_reset_count: 1,
    notifications: [],
    actions: [],
    rules: [],
  };

  let showAddRule = false;
  let showAddNotification = false;
  let showAddAction = false;
  let newRule: Rule = { type: 'detection' };
  let newNotification: NewNotification = { type: 'sms' };
  let newAction: Action = { resource: '', method: '', payload: '', when_secs: 0 };

  // New state for event manager management
  let loading = true;
  let error = '';
  let eventManagers: any[] = [];
  let showEventManagerForm = false;
  let editingEventManager: any = null;
  let saving = false;
  let saveError = '';
  let machineComponents: any[] = [];

  // Reactive lists for dropdowns
  $: cameras = machineComponents.filter(c => c.api.startsWith('rdk:component:camera')).map(c => c.name);
  $: visionServices = machineComponents.filter(c => c.api.startsWith('rdk:service:vision')).map(c => c.name);
  $: allResources = machineComponents.map(c => c.name);

  $: callRuleApi = machineComponents.find(c => c.name === newRule.resource)?.api;
  $: callRuleMethods = (() => {
    if (!callRuleApi) return [];
    const methodsKey = Object.keys(resourceMethods).find(key => callRuleApi.startsWith(key));
    if (!methodsKey) return [];
    return (resourceMethods as Record<string, string[]>)[methodsKey] || [];
  })();

  $: actionApi = machineComponents.find(c => c.name === newAction.resource)?.api;
  $: actionMethods = (() => {
    if (!actionApi) return [];
    const methodsKey = Object.keys(resourceMethods).find(key => actionApi.startsWith(key));
    if (!methodsKey) return [];
    return (resourceMethods as Record<string, string[]>)[methodsKey] || [];
  })();

  $: {
    if (callRuleApi) {
      console.log(`Resource: ${newRule.resource}, API: ${callRuleApi}, Methods:`, callRuleMethods);
    }
    if (actionApi) {
      console.log(`Action Resource: ${newAction.resource}, API: ${actionApi}, Methods:`, actionMethods);
    }
  }

  // Auto-manage resources based on rules and actions
  $: {
    const autoResources: Record<string, {type: string, subtype: string}> = {};
    
    // Add resources from rules
    config.rules.forEach(rule => {
      if (rule.camera) {
        const component = machineComponents.find(c => c.name === rule.camera);
        if (component) {
          autoResources[rule.camera] = {
            type: 'component',
            subtype: component.api.split(':')[2] || 'camera'
          };
        }
      }
      if (rule.detector || rule.classifier || rule.tracker) {
        const serviceName = rule.detector || rule.classifier || rule.tracker;
        if (serviceName) {
          const service = machineComponents.find(c => c.name === serviceName);
          if (service) {
            autoResources[serviceName] = {
              type: 'service',
              subtype: service.api.split(':')[2] || 'vision'
            };
          }
        }
      }
      if (rule.resource) {
        const component = machineComponents.find(c => c.name === rule.resource);
        if (component) {
          autoResources[rule.resource] = {
            type: 'component',
            subtype: component.api.split(':')[2] || 'generic'
          };
        }
      }
    });
    
    // Add resources from actions
    config.actions.forEach(action => {
      if (action.resource) {
        const component = machineComponents.find(c => c.name === action.resource);
        if (component) {
          autoResources[action.resource] = {
            type: 'component',
            subtype: component.api.split(':')[2] || 'generic'
          };
        }
      }
    });
    
    config.resources = autoResources;
  }

  onMount(async () => {
    if (viamClient) {
      try {
        console.log("Loading machine config...");
        const machineConfig = await getMachineConfig();
        
        if (machineConfig) {
          console.log("Machine config loaded:", machineConfig);
          eventManagers = findEventManagers(machineConfig);
          machineComponents = machineConfig.config?.components || [];
          console.log("Found event managers:", eventManagers);
          console.log("Found machine components:", machineComponents);
        } else {
          error = "Failed to load machine configuration";
        }
      } catch (err) {
        console.error("Error loading machine config:", err);
        error = "Error loading machine configuration";
      } finally {
        loading = false;
      }
    } else {
      error = "Viam client not available";
      loading = false;
    }
  });

  function openEventManagerForm(eventManager?: any) {
    if (eventManager) {
      // Load existing config
      editingEventManager = eventManager;
      config = {
        name: eventManager.name,
        pause_alerting_on_event_secs: eventManager.config.pause_alerting_on_event_secs || 300,
        detection_hz: eventManager.config.detection_hz || 5,
        rule_logic_type: eventManager.config.rule_logic_type || 'AND',
        trigger_sequence_count: eventManager.config.trigger_sequence_count || 1,
        require_rule_reset: eventManager.config.require_rule_reset || false,
        rule_reset_count: eventManager.config.rule_reset_count || 1,
        notifications: eventManager.config.notifications || [],
        actions: eventManager.config.actions || [],
        rules: eventManager.config.rules || [],
        backoff_schedule: eventManager.config.backoff_schedule,
        resources: eventManager.config.resources || {},
      };
    } else {
      // Create new config
      editingEventManager = null;
      config = {
        name: '',
        pause_alerting_on_event_secs: 300,
        detection_hz: 5,
        rule_logic_type: 'AND',
        trigger_sequence_count: 1,
        require_rule_reset: false,
        rule_reset_count: 1,
        notifications: [],
        actions: [],
        rules: [],
        backoff_schedule: {},
        resources: {},
      };
    }
    showEventManagerForm = true;
    saveError = '';
  }

  function closeEventManagerForm() {
    showEventManagerForm = false;
    editingEventManager = null;
    saveError = '';
  }

  async function saveEventManagerConfig() {
    if (!config.name.trim()) {
      saveError = "Event manager name is required";
      return;
    }

    saving = true;
    saveError = '';

    try {
      // Prepare the event manager config (exclude the name field)
      const eventManagerConfig: any = {
        pause_alerting_on_event_secs: config.pause_alerting_on_event_secs,
        detection_hz: config.detection_hz,
        rule_logic_type: config.rule_logic_type,
        trigger_sequence_count: config.trigger_sequence_count,
        require_rule_reset: config.require_rule_reset,
        rule_reset_count: config.rule_reset_count,
        notifications: config.notifications,
        actions: config.actions,
        rules: config.rules,
      };

      // Add backoff_schedule if it exists
      if (config.backoff_schedule) {
        eventManagerConfig.backoff_schedule = config.backoff_schedule;
      }

      // Add resources if they exist
      if (config.resources) {
        eventManagerConfig.resources = config.resources;
      }

      // If editing, use the original name to identify which event manager to update
      const originalName = editingEventManager ? editingEventManager.name : null;
      const targetName = config.name; // This is the new name (might be the same or different)
      
      if (editingEventManager && originalName !== targetName) {
        // We're renaming an event manager - we need to delete the old one and create a new one
        // For now, let's just create the new one and let the backend handle the old one
        console.log("Renaming event manager from", originalName, "to", targetName);
      }

      await saveEventManager(targetName, eventManagerConfig, originalName);
      
      // Refresh the event managers list
      const machineConfig = await getMachineConfig();
      if (machineConfig) {
        eventManagers = findEventManagers(machineConfig);
      }
      
      // Close the form and show success
      closeEventManagerForm();
    } catch (err: any) {
      console.error("Error saving event manager:", err);
      saveError = `Failed to save event manager: ${err.message}`;
    } finally {
      saving = false;
    }
  }

  function addRule() {
    if (newRule.type) {
      config.rules = [...config.rules, { ...newRule }];
      newRule = { type: 'detection' };
      showAddRule = false;
    }
  }

  function addNotification() {
    if (newNotification.type) {
      const notificationToAdd: Notification = {
        type: newNotification.type,
        preset: newNotification.preset,
        include_image: newNotification.include_image,
        url: newNotification.url,
      };

      if (newNotification.to) {
        notificationToAdd.to = newNotification.to.split(',').map(s => s.trim()).filter(Boolean);
      }
      if (newNotification.fcm_tokens) {
        notificationToAdd.fcm_tokens = newNotification.fcm_tokens.split(',').map(s => s.trim()).filter(Boolean);
      }

      config.notifications = [...config.notifications, notificationToAdd];
      newNotification = { type: 'sms' };
      showAddNotification = false;
    }
  }

  function addAction() {
    if (newAction.resource && newAction.method && newAction.payload !== undefined) {
      config.actions = [...config.actions, { ...newAction }];
      newAction = { resource: '', method: '', payload: '', when_secs: 0 };
      showAddAction = false;
    }
  }

  function removeRule(index: number) {
    config.rules = config.rules.filter((_, i) => i !== index);
  }

  function removeNotification(index: number) {
    config.notifications = config.notifications.filter((_, i) => i !== index);
  }

  function removeAction(index: number) {
    config.actions = config.actions.filter((_, i) => i !== index);
  }
</script>

{#if loading}
  <div class="loading">
    <h2>Loading machine configuration...</h2>
  </div>
{:else if error}
  <div class="error">
    <h2>Error</h2>
    <p>{error}</p>
  </div>
{:else if showEventManagerForm}
  <!-- Event Manager Configuration Form -->
  <div class="container">
    <div class="header">
      <h1>{editingEventManager ? 'Edit' : 'Create'} Event Manager</h1>
      <button class="btn btn-secondary" on:click={closeEventManagerForm}>Back to List</button>
    </div>
    
    {#if saveError}
      <div class="error-message">
        <p>{saveError}</p>
      </div>
    {/if}
    
    <div class="form-section">
      <h2>Basic Settings</h2>
      <div class="form-group">
        <label for="name">Event Name:</label>
        <input id="name" type="text" bind:value={config.name} placeholder="Enter event name" />
      </div>
      
      <div class="form-group">
        <label for="pause_alerting">
          Pause Alerting (seconds):
          <span class="help-tooltip" title="How long to pause alerting after an event triggers before allowing new alerts for the same event">?</span>
        </label>
        <input id="pause_alerting" type="number" bind:value={config.pause_alerting_on_event_secs} min="0" />
      </div>
      
      <div class="form-group">
        <label for="detection_hz">
          Detection Frequency (Hz):
          <span class="help-tooltip" title="How often rules are evaluated per second. Higher values mean more frequent checking but more resource usage">?</span>
        </label>
        <input id="detection_hz" type="number" bind:value={config.detection_hz} min="1" max="60" />
      </div>
      
      <div class="form-group">
        <label for="rule_logic">
          Rule Logic Type:
          <span class="help-tooltip" title="Logic gate to use when combining multiple rules. AND: all rules must be true. OR: any rule can be true. XOR: exactly one rule must be true">?</span>
        </label>
        <select id="rule_logic" bind:value={config.rule_logic_type}>
          <option value="AND">AND</option>
          <option value="OR">OR</option>
          <option value="XOR">XOR</option>
          <option value="NOR">NOR</option>
          <option value="NAND">NAND</option>
          <option value="XNOR">XNOR</option>
        </select>
      </div>
      
      <div class="form-group">
        <label for="trigger_sequence">
          Trigger Sequence Count:
          <span class="help-tooltip" title="How many times in a row an event must evaluate as true to be considered triggered. Helps reduce false positives">?</span>
        </label>
        <input id="trigger_sequence" type="number" bind:value={config.trigger_sequence_count} min="1" />
      </div>
      
      <div class="form-group checkbox-group">
        <label>
          <input type="checkbox" bind:checked={config.require_rule_reset} />
          Require Rule Reset
          <span class="help-tooltip" title="When enabled, an event won't trigger again until rules evaluate to false, then true again. Useful for detecting state changes">?</span>
        </label>
      </div>
      
      {#if config.require_rule_reset}
        <div class="form-group">
          <label for="rule_reset_count">
            Rule Reset Count:
            <span class="help-tooltip" title="How many consecutive times rules must evaluate to false before the event can be re-triggered">?</span>
          </label>
          <input id="rule_reset_count" type="number" bind:value={config.rule_reset_count} min="1" />
        </div>
      {/if}
    </div>

    <div class="form-section">
      <h2>Rules</h2>
      {#each config.rules as rule, index}
        <div class="rule-item">
          <h3>Rule {index + 1}: {rule.type}</h3>
          {#if rule.camera}
            <p>Camera: {rule.camera}</p>
          {/if}
          {#if rule.detector}
            <p>Detector: {rule.detector}</p>
          {/if}
          {#if rule.classifier}
            <p>Classifier: {rule.classifier}</p>
          {/if}
          {#if rule.tracker}
            <p>Tracker: {rule.tracker}</p>
          {/if}
          {#if rule.resource}
            <p>Resource: {rule.resource}</p>
          {/if}
          {#if rule.method}
            <p>Method: {rule.method}</p>
          {/if}
          {#if rule.payload}
            <p>Payload: {rule.payload}</p>
          {/if}
          {#if rule.result_path}
            <p>Result Path: {rule.result_path}</p>
          {/if}
          {#if rule.result_function}
            <p>Result Function: {rule.result_function}</p>
          {/if}
          {#if rule.result_operator}
            <p>Result Operator: {rule.result_operator}</p>
          {/if}
          {#if rule.result_value}
            <p>Result Value: {rule.result_value}</p>
          {/if}
          {#if rule.inverse_pause_secs}
            <p>Inverse Pause: {rule.inverse_pause_secs} seconds</p>
          {/if}
          {#if rule.class_regex}
            <p>Class Regex: {rule.class_regex}</p>
          {/if}
          {#if rule.confidence_pct}
            <p>Confidence: {rule.confidence_pct * 100}%</p>
          {/if}
          <button class="remove-btn" on:click={() => removeRule(index)}>Remove</button>
        </div>
      {/each}
      
      {#if showAddRule}
        <div class="add-form">
          <h3>Add New Rule</h3>
          <div class="form-group">
            <label for="rule_type">Rule Type:</label>
            <select id="rule_type" bind:value={newRule.type}>
              <option value="detection">Detection</option>
              <option value="classification">Classification</option>
              <option value="tracker">Tracker</option>
              <option value="time">Time</option>
              <option value="call">Call</option>
            </select>
          </div>
          
          {#if ['detection', 'classification', 'tracker'].includes(newRule.type)}
            <div class="form-group">
              <label for="camera">Camera:</label>
              <select id="camera" bind:value={newRule.camera}>
                <option value="">Select a camera</option>
                {#each cameras as cameraName}
                  <option value={cameraName}>{cameraName}</option>
                {/each}
              </select>
            </div>
            
            {#if newRule.type === 'detection'}
              <div class="form-group">
                <label for="detector">Detector:</label>
                <select id="detector" bind:value={newRule.detector}>
                  <option value="">Select a vision service</option>
                  {#each visionServices as serviceName}
                    <option value={serviceName}>{serviceName}</option>
                  {/each}
                </select>
              </div>
            {/if}
            
            {#if newRule.type === 'classification'}
              <div class="form-group">
                <label for="classifier">Classifier:</label>
                 <select id="classifier" bind:value={newRule.classifier}>
                  <option value="">Select a vision service</option>
                  {#each visionServices as serviceName}
                    <option value={serviceName}>{serviceName}</option>
                  {/each}
                </select>
              </div>
            {/if}
            
            {#if newRule.type === 'tracker'}
              <div class="form-group">
                <label for="tracker">Tracker:</label>
                <select id="tracker" bind:value={newRule.tracker}>
                  <option value="">Select a vision service</option>
                  {#each visionServices as serviceName}
                    <option value={serviceName}>{serviceName}</option>
                  {/each}
                </select>
              </div>
            {/if}
            
            <div class="form-group">
              <label for="class_regex">Class Regex:</label>
              <input id="class_regex" type="text" bind:value={newRule.class_regex} placeholder=".*" />
            </div>
            
            <div class="form-group">
              <label for="confidence_pct">Confidence %:</label>
              <input id="confidence_pct" type="number" bind:value={newRule.confidence_pct} min="0" max="1" step="0.1" />
            </div>
          {/if}
          
          {#if newRule.type === 'time'}
            <div class="form-group">
              <label>Time Ranges (UTC):</label>
              <p class="help-text">Add time ranges in 24-hour format</p>
            </div>
          {/if}
          
          {#if newRule.type === 'call'}
            <div class="form-group">
              <label for="resource">Resource:</label>
              <select id="resource" bind:value={newRule.resource}>
                <option value="">Select a resource</option>
                {#each allResources as resourceName}
                  <option value={resourceName}>{resourceName}</option>
                {/each}
              </select>
            </div>
            
            <div class="form-group">
              <label for="method">Method:</label>
              <select id="method" bind:value={newRule.method} disabled={!newRule.resource}>
                <option value="">Select a method</option>
                {#each callRuleMethods as methodName}
                  <option value={methodName}>{methodName}</option>
                {/each}
              </select>
            </div>
            
            <div class="form-group">
              <label for="payload">Payload (JSON):</label>
              <input id="payload" type="text" bind:value={newRule.payload} placeholder="JSON object, e.g. 'key': 'value'" />
            </div>
            
            <div class="form-group">
              <label for="result_path">
                Result Path (optional):
                <span class="help-tooltip" title="JavaScript dot notation path to access a property in the result. Example: 'data.value' or 'items.0.name'">?</span>
              </label>
              <input id="result_path" type="text" bind:value={newRule.result_path} placeholder="e.g., data.value" />
            </div>
            
            <div class="form-group">
              <label for="result_function">
                Result Function (optional):
                <span class="help-tooltip" title="Function to apply to the result before comparison. 'len' for length, 'any' for checking if any item is truthy">?</span>
              </label>
              <select id="result_function" bind:value={newRule.result_function}>
                <option value="">None</option>
                <option value="len">len</option>
                <option value="any">any</option>
              </select>
            </div>
            
            <div class="form-group">
              <label for="result_operator">
                Result Operator:
                <span class="help-tooltip" title="Operator to use when comparing the result with the result value">?</span>
              </label>
              <select id="result_operator" bind:value={newRule.result_operator}>
                <option value="">Select operator</option>
                <option value="eq">Equal (eq)</option>
                <option value="ne">Not Equal (ne)</option>
                <option value="lt">Less Than (lt)</option>
                <option value="lte">Less Than or Equal (lte)</option>
                <option value="gt">Greater Than (gt)</option>
                <option value="gte">Greater Than or Equal (gte)</option>
                <option value="regex">Regex Match (regex)</option>
                <option value="in">In (in)</option>
                <option value="hasattr">Has Attribute (hasattr)</option>
              </select>
            </div>
            
            <div class="form-group">
              <label for="result_value">
                Result Value:
                <span class="help-tooltip" title="Value to compare against using the selected operator">?</span>
              </label>
              <input id="result_value" type="text" bind:value={newRule.result_value} placeholder="Value to compare against" />
            </div>
            
            <div class="form-group">
              <label for="inverse_pause_secs">
                Inverse Pause (seconds, optional):
                <span class="help-tooltip" title="Duration to pause event evaluation when the result evaluates to false">?</span>
              </label>
              <input id="inverse_pause_secs" type="number" bind:value={newRule.inverse_pause_secs} min="0" placeholder="Pause duration when result is false" />
            </div>
          {/if}
          
          <div class="button-group">
            <button class="btn btn-primary" on:click={addRule}>Add Rule</button>
            <button class="btn btn-secondary" on:click={() => showAddRule = false}>Cancel</button>
          </div>
        </div>
      {:else}
        <button class="btn btn-primary" on:click={() => showAddRule = true}>Add Rule</button>
      {/if}
    </div>

    <div class="form-section">
      <h2>Notifications</h2>
      {#each config.notifications as notification, index}
        <div class="notification-item">
          <h3>Notification {index + 1}: {notification.type}</h3>
          {#if notification.to}
            <p>To: {notification.to.join(', ')}</p>
          {/if}
          {#if notification.url}
            <p>URL: {notification.url}</p>
          {/if}
          <button class="remove-btn" on:click={() => removeNotification(index)}>Remove</button>
        </div>
      {/each}
      
      {#if showAddNotification}
        <div class="add-form">
          <h3>Add New Notification</h3>
          <div class="form-group">
            <label for="notification_type">Type:</label>
            <select id="notification_type" bind:value={newNotification.type}>
              <option value="sms">SMS</option>
              <option value="email">Email</option>
              <option value="webhook_get">Webhook GET</option>
              <option value="push">Push</option>
            </select>
          </div>
          
          {#if newNotification.type === 'sms' || newNotification.type === 'email'}
            <div class="form-group">
              <label for="preset">
                Preset:
                <span class="help-tooltip" title="Name of the preset message template to use for this notification type">?</span>
              </label>
              <input id="preset" type="text" bind:value={newNotification.preset} placeholder="e.g., twilio_sms" />
            </div>

            <div class="form-group">
              <label for="to">
                To (comma-separated):
                <span class="help-tooltip" title="Phone numbers for SMS or email addresses for email, separated by commas">?</span>
              </label>
              <input id="to" type="text" bind:value={newNotification.to} placeholder="phone@example.com, +1234567890" />
            </div>
          {/if}
          
          {#if newNotification.type === 'webhook_get'}
            <div class="form-group">
              <label for="url">URL:</label>
              <input id="url" type="url" bind:value={newNotification.url} placeholder="https://example.com/webhook" />
            </div>
          {/if}
          
          {#if newNotification.type === 'push'}
            <div class="form-group">
              <label for="fcm_tokens">FCM Tokens (comma-separated):</label>
              <input id="fcm_tokens" type="text" bind:value={newNotification.fcm_tokens} placeholder="token1, token2" />
            </div>
          {/if}
          
          <div class="form-group">
            <label>
              <input type="checkbox" bind:checked={newNotification.include_image} />
              Include Image
            </label>
          </div>
          
          <div class="button-group">
            <button class="btn btn-primary" on:click={addNotification}>Add Notification</button>
            <button class="btn btn-secondary" on:click={() => showAddNotification = false}>Cancel</button>
          </div>
        </div>
      {:else}
        <button class="btn btn-primary" on:click={() => showAddNotification = true}>Add Notification</button>
      {/if}
    </div>

    <div class="form-section">
      <h2>Actions</h2>
      {#each config.actions as action, index}
        <div class="action-item">
          <h3>Action {index + 1}</h3>
          <p>Resource: {action.resource}</p>
          <p>Method: {action.method}</p>
          <p>Payload: {action.payload}</p>
          {#if action.when_secs !== 0}
            <p>Delay: {action.when_secs} seconds</p>
          {/if}
          <button class="remove-btn" on:click={() => removeAction(index)}>Remove</button>
        </div>
      {/each}
      
      {#if showAddAction}
        <div class="add-form">
          <h3>Add New Action</h3>
          <div class="form-group">
            <label for="action_resource">Resource:</label>
            <select id="action_resource" bind:value={newAction.resource}>
              <option value="">Select a resource</option>
              {#each allResources as resourceName}
                <option value={resourceName}>{resourceName}</option>
              {/each}
            </select>
          </div>
          
          <div class="form-group">
            <label for="action_method">Method:</label>
            <select id="action_method" bind:value={newAction.method} disabled={!newAction.resource}>
              <option value="">Select a method</option>
              {#each actionMethods as methodName}
                <option value={methodName}>{methodName}</option>
              {/each}
            </select>
          </div>
          
          <div class="form-group">
            <label for="action_payload">Payload (JSON):</label>
            <input id="action_payload" type="text" bind:value={newAction.payload} placeholder="JSON object, e.g. 'key': 'value'" />
          </div>
          
          <div class="form-group">
            <label for="when_secs">
              Delay (seconds):
              <span class="help-tooltip" title="How many seconds after the event triggers should this action occur. Use -1 to disable automatic execution">?</span>
            </label>
            <input id="when_secs" type="number" bind:value={newAction.when_secs} min="-1" />
          </div>
          
          <div class="form-group">
            <label for="response_match">
              Response Match (regex):
              <span class="help-tooltip" title="If a response matches this regex pattern, this action will be triggered. Leave empty for no response matching">?</span>
            </label>
            <input id="response_match" type="text" bind:value={newAction.response_match} placeholder="optional" />
          </div>
          
          <div class="button-group">
            <button class="btn btn-primary" on:click={addAction}>Add Action</button>
            <button class="btn btn-secondary" on:click={() => showAddAction = false}>Cancel</button>
          </div>
        </div>
      {:else}
        <button class="btn btn-primary" on:click={() => showAddAction = true}>Add Action</button>
      {/if}
    </div>

    <div class="form-section">
      <h2>Auto-Managed Resources</h2>
      <p class="help-text">Resources are automatically added based on what's referenced in your rules and actions.</p>
      
      {#if config.resources && Object.keys(config.resources).length > 0}
        <div class="resources-list">
          {#each Object.entries(config.resources) as [name, resource]}
            <div class="resource-item">
              <span class="resource-name">{name}</span>
              <span class="resource-type">{resource.type}:{resource.subtype}</span>
            </div>
          {/each}
        </div>
      {:else}
        <p class="empty-resources">No resources referenced yet. Add rules or actions to see resources here.</p>
      {/if}
    </div>

    <div class="form-section">
      <button class="btn btn-success" on:click={saveEventManagerConfig} disabled={saving}>
        {saving ? 'Saving...' : 'Save Event Manager'}
      </button>
    </div>
  </div>
{:else}
  <!-- Event Manager List -->
  <div class="container">
    <div class="header">
      <h1>Event Manager Configuration</h1>
      <button class="btn btn-primary" on:click={() => openEventManagerForm()}>Create New Event Manager</button>
    </div>

    {#if eventManagers.length === 0}
      <div class="empty-state">
        <h2>No Event Managers Found</h2>
        <p>No event manager configurations were found in the machine config.</p>
        <button class="btn btn-primary" on:click={() => openEventManagerForm()}>Create Your First Event Manager</button>
      </div>
    {:else}
      <div class="event-managers-list">
        <h2>Existing Event Managers</h2>
        {#each eventManagers as eventManager}
          <div class="event-manager-item">
            <div class="event-manager-info">
              <h3>{eventManager.name}</h3>
              <p>Rules: {eventManager.config.rules?.length || 0}</p>
              <p>Notifications: {eventManager.config.notifications?.length || 0}</p>
              <p>Actions: {eventManager.config.actions?.length || 0}</p>
            </div>
            <div class="event-manager-actions">
              <button class="btn btn-primary" on:click={() => openEventManagerForm(eventManager)}>Edit</button>
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </div>
{/if}

<style>
  .container {
    max-width: 1200px;
    margin: 0 auto;
    padding: 20px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  }

  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 30px;
  }

  .loading, .error {
    text-align: center;
    padding: 40px;
  }

  .error-message {
    background: #f8d7da;
    color: #721c24;
    border: 1px solid #f5c6cb;
    border-radius: 4px;
    padding: 12px;
    margin-bottom: 20px;
  }

  .empty-state {
    text-align: center;
    padding: 60px 20px;
    background: #f8f9fa;
    border-radius: 8px;
    margin: 20px 0;
  }

  .event-managers-list {
    margin-top: 20px;
  }

  .event-manager-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    background: white;
    border: 1px solid #dee2e6;
    border-radius: 6px;
    padding: 20px;
    margin-bottom: 15px;
  }

  .event-manager-info h3 {
    margin: 0 0 10px 0;
    color: #495057;
  }

  .event-manager-info p {
    margin: 5px 0;
    color: #6c757d;
    font-size: 14px;
  }

  .event-manager-actions {
    display: flex;
    gap: 10px;
  }

  h1 {
    color: #333;
    margin-bottom: 0;
  }

  .form-section {
    background: #f8f9fa;
    border-radius: 8px;
    padding: 20px;
    margin-bottom: 20px;
    border: 1px solid #e9ecef;
  }

  .form-section h2 {
    color: #495057;
    margin-top: 0;
    border-bottom: 2px solid #007bff;
    padding-bottom: 10px;
  }

  .form-group {
    margin-bottom: 15px;
  }

  .form-group label {
    display: block;
    margin-bottom: 5px;
    font-weight: 500;
    color: #495057;
    position: relative;
  }

  .form-group input,
  .form-group select {
    width: 100%;
    padding: 8px 12px;
    border: 1px solid #ced4da;
    border-radius: 4px;
    font-size: 14px;
    box-sizing: border-box;
  }

  .form-group input:focus,
  .form-group select:focus {
    outline: none;
    border-color: #007bff;
    box-shadow: 0 0 0 2px rgba(0, 123, 255, 0.25);
  }

  /* Checkbox alignment */
  .checkbox-group {
    display: flex;
    align-items: flex-start;
  }

  .checkbox-group label {
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
    margin: 0;
  }

  .checkbox-group input[type="checkbox"] {
    width: auto;
    margin: 0;
    flex-shrink: 0;
  }

  .btn {
    padding: 10px 20px;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 14px;
    font-weight: 500;
    transition: all 0.2s;
  }

  .btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .btn-primary {
    background: #007bff;
    color: white;
  }

  .btn-primary:hover:not(:disabled) {
    background: #0056b3;
  }

  .btn-secondary {
    background: #6c757d;
    color: white;
  }

  .btn-secondary:hover:not(:disabled) {
    background: #545b62;
  }

  .btn-success {
    background: #28a745;
    color: white;
    font-size: 16px;
    padding: 12px 24px;
  }

  .btn-success:hover:not(:disabled) {
    background: #1e7e34;
  }

  .remove-btn {
    background: #dc3545;
    color: white;
    padding: 5px 10px;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
  }

  .remove-btn:hover {
    background: #c82333;
  }

  .button-group {
    display: flex;
    gap: 10px;
    margin-top: 15px;
  }

  .add-form {
    background: white;
    border: 1px solid #dee2e6;
    border-radius: 6px;
    padding: 20px;
    margin-top: 15px;
  }

  .rule-item,
  .notification-item,
  .action-item {
    background: white;
    border: 1px solid #dee2e6;
    border-radius: 6px;
    padding: 15px;
    margin-bottom: 10px;
  }

  .rule-item h3,
  .notification-item h3,
  .action-item h3 {
    margin-top: 0;
    color: #495057;
    font-size: 16px;
  }

  .help-text {
    color: #6c757d;
    font-size: 12px;
    margin-top: 5px;
  }

  /* Tooltip Styles */
  .help-tooltip {
    margin-left: 5px;
    color: #007bff;
    cursor: pointer;
    text-decoration: none;
    position: relative;
    display: inline-block;
    width: 14px;
    height: 14px;
    line-height: 14px;
    border-radius: 50%;
    background-color: #007bff;
    color: white;
    font-size: 10px;
    text-align: center;
    vertical-align: middle;
    transition: background-color 0.2s ease;
    user-select: none;
  }

  .help-tooltip:hover {
    text-decoration: none;
    background-color: #0056b3;
  }

  .help-tooltip::after {
    content: "?";
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    font-weight: bold;
  }

  .tooltip-popup {
    position: absolute;
    background: #333;
    color: white;
    padding: 8px 12px;
    border-radius: 4px;
    font-size: 12px;
    max-width: 250px;
    z-index: 1000;
    box-shadow: 0 2px 8px rgba(0,0,0,0.3);
    white-space: normal;
    line-height: 1.4;
    top: 25px;
    left: 0;
    min-width: 200px;
  }

  .tooltip-popup::before {
    content: '';
    position: absolute;
    top: -4px;
    left: 10px;
    width: 0;
    height: 0;
    border-left: 4px solid transparent;
    border-right: 4px solid transparent;
    border-bottom: 4px solid #333;
  }

  /* Fix form overflow */
  .form-group input,
  .form-group select {
    width: 100%;
    padding: 8px 12px;
    border: 1px solid #ced4da;
    border-radius: 4px;
    font-size: 14px;
    box-sizing: border-box;
  }

  .form-group input:focus,
  .form-group select:focus {
    outline: none;
    border-color: #007bff;
    box-shadow: 0 0 0 2px rgba(0, 123, 255, 0.25);
  }

  /* Make tooltips appear instantly */
  [title] {
    transition-delay: 0s !important;
    --tooltip-delay: 0s;
  }

  /* Override browser tooltip delay */
  *[title]:hover::after {
    transition-delay: 0s !important;
    animation-delay: 0s !important;
  }

  /* Try to reduce tooltip delay */
  .help-tooltip {
    margin-left: 5px;
    color: #007bff;
    cursor: help;
    text-decoration: none;
    position: relative;
    display: inline-block;
    width: 14px;
    height: 14px;
    line-height: 14px;
    border-radius: 50%;
    background-color: #007bff;
    color: white;
    font-size: 10px;
    text-align: center;
    vertical-align: middle;
    transition: background-color 0.2s ease;
    user-select: none;
    /* Try to reduce tooltip delay */
    -webkit-tooltip-delay: 0s;
    tooltip-delay: 0s;
  }

  /* New styles for resource display */
  .resources-list {
    margin-top: 15px;
    padding-top: 15px;
    border-top: 1px solid #e9ecef;
  }

  .resources-list h3 {
    margin-top: 0;
    color: #495057;
    font-size: 16px;
    margin-bottom: 10px;
  }

  .resource-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    background: #f1f3f5;
    border: 1px solid #dee2e6;
    border-radius: 4px;
    padding: 8px 12px;
    margin-bottom: 8px;
    font-size: 14px;
    color: #343a40;
  }

  .resource-name {
    font-weight: 500;
    color: #007bff;
  }

  .resource-type {
    font-size: 12px;
    color: #6c757d;
  }
</style>
