'use strict';

var self = normalizeSteps;
module.exports = self;

var path = require('path');

function normalizeSteps(yml, buildJobId, buildScriptsDir, buildStatusDir) {
  var clonedSteps = _.clone(yml.steps);
  clonedSteps = _convertOldFormatStepsToNew(clonedSteps);
  clonedSteps = _normalizeNewFormatSteps(clonedSteps, yml.runtime,
    __convertOldFormatTerminalGroupToNew(yml.on_success),
    __convertOldFormatTerminalGroupToNew(yml.on_failure),
    __convertOldFormatTerminalGroupToNew(yml.always), buildJobId,
    buildScriptsDir, buildStatusDir
  );

  return clonedSteps;
}

function _convertOldFormatStepsToNew(steps) {
  _.each(steps,
    function (step) {
      if (!step.TASK)
        return;

      // if TASK is in old format convert it to new format
      if (_.isArray(step.TASK)) {
        var newTask = {
          script: []
        };
        _.each(step.TASK,
          function (oldTask) {
            if (oldTask.script)
              newTask.script.push(oldTask.script);
          }
        );
        step.TASK = newTask;
      }
    }
  );

  return steps;
}

function _normalizeNewFormatSteps(steps, defaultRuntime, onSuccess,
  onFailure, always, buildJobId, buildScriptsDir, buildStatusDir) {
  var clonedSteps = _.clone(steps);
  var defaultJobRuntime = _.clone(defaultRuntime) || {};
  var defaultIsContainer = true;

  // TODO: The image names need to be come from a config.
  var imageName = 'drydock/microbase';
  if (global.config.shippableNodeArchitecture === 'aarch64')
    imageName = 'drydockaarch64/microbase';
  var defaultContainerOpts = {
    'imageName': imageName,
    'imageTag': global.config.shippableReleaseVersion,
    'pull': true,
    'options': {
      env: {},
      options: util.format('%s %s', global.config.defaultTaskContainerOptions,
        global.config.defaultTaskContainerMounts)
    }
  };
  var defaultHostOpts = {
    options: {
      env: {}
    }
  };

  if (defaultJobRuntime.container === false)
    defaultIsContainer = false;
  if (defaultJobRuntime.container)
    _.extend(defaultContainerOpts, defaultJobRuntime.options);
  else
    _.extend(defaultHostOpts, defaultJobRuntime.options);

  var lastTask;
  var taskIndex = 0;
  _.each(clonedSteps,
    function (step) {
      if (!step.TASK) return;
      if (!step.TASK.script) return;

      var task = step.TASK;

      if (_.isString(task.script))
        task.script = [task.script];

      task.runtime = task.runtime || {};
      if (_.isUndefined(task.runtime.container))
        task.runtime.container = defaultIsContainer;

      if (task.runtime.container) {
        if (_.isEmpty(task.runtime.options))
          task.runtime.options = _.clone(defaultContainerOpts.options);
        if (_.isEmpty(task.runtime.options.imageName) ||
          _.isEmpty(task.runtime.options.imageTag)) {
          task.runtime.options.imageName = defaultContainerOpts.imageName;
          task.runtime.options.imageTag = defaultContainerOpts.imageTag;
        }
        if (!_.isBoolean(task.runtime.options.pull))
          task.runtime.options.pull = defaultContainerOpts.pull;
        if (_.isEmpty(task.runtime.options.options))
          task.runtime.options.options = '';
        if (_.isEmpty(task.runtime.options.env))
          task.runtime.options.env = _.clone(defaultContainerOpts.options.env);
        task.runtime.options.options = util.format('%s %s',
          defaultContainerOpts.options.options, task.runtime.options.options);
      } else {
        if (_.isEmpty(task.runtime.options))
          task.runtime.options = _.clone(defaultHostOpts.options);
        if (_.isEmpty(task.runtime.options.env))
          task.runtime.options.env = _.clone(defaultHostOpts.options.env);
      }

      if (_.isUndefined(task.name))
        task.name = 'Task ' + taskIndex;

      task.always = always;
      task.onFailure = onFailure;

      task.taskIndex = taskIndex;
      __generateRuntimeInfo(task, buildJobId, buildScriptsDir, buildStatusDir);
      task.runtime.options.env = __normalizeEnvs(task.runtime.options.env);
      lastTask = task;
      taskIndex += 1;
    }
  );
  lastTask.onSuccess = onSuccess;

  return clonedSteps;
}

function __generateRuntimeInfo(task, buildJobId, buildScriptsDir,
  buildStatusDir) {
  var defaultENVs = {
    shippableNodeArchitecture: global.config.shippableNodeArchitecture,
    shippableNodeOperatingSystem: global.config.shippableNodeOperatingSystem
  };
  var taskEnvs = _.extend({}, defaultENVs);
  _.extend(taskEnvs, {
    taskName: task.name || util.format('task_%s', task.taskIndex),
    isTaskInContainer: task.runtime.container
  });
  task.taskScriptFileName = util.format('task_%s.sh', task.taskIndex);
  if (task.runtime.container) {
    var containerName =  util.format('reqExec.%s.%s', buildJobId,
      task.taskIndex);
    task.runtime.options.options = util.format('%s --name %s',
      task.runtime.options.options, containerName);
    task.bootScriptFileName = util.format('boot_%s.sh', task.taskIndex);
    // sets container task envs
    var taskContainerEnvs = {
      taskContainerOptions: task.runtime.options.options,
      taskContainerImage: util.format('%s:%s',
        task.runtime.options.imageName, task.runtime.options.imageTag),
      shouldPullTaskContainerImage: task.runtime.options.pull,
      taskContainerCommand: util.format('%s %s %s',
        global.config.taskContainerCommand,
        path.join(buildScriptsDir, task.taskScriptFileName),
        path.join(buildStatusDir, 'job.env')
      )
    };
    _.extend(taskEnvs, taskContainerEnvs);
  }
  task.shippableRuntimeEnvs = taskEnvs;
}

function __convertOldFormatTerminalGroupToNew(terminalGroup) {
  var clonedTerminalGroup = _.clone(terminalGroup);
  var newTerminalGroup = {
    script: []
  };

  // If the group is not defined, return the default group.
  if (_.isEmpty(clonedTerminalGroup))
    return newTerminalGroup;
  // If the group is of array type (old), convert it into object.
  else if (_.isArray(clonedTerminalGroup))
    _.each(clonedTerminalGroup,
      function (section) {
        if (section.script)
          newTerminalGroup.script.push(section.script);
      }
    );
  // If the group is of object type (new), convert any string script to array.
  else if (_.isObject(terminalGroup))
    if (_.isString(clonedTerminalGroup.script))
      newTerminalGroup.script.push(clonedTerminalGroup.script);

  return newTerminalGroup;
}


function __normalizeEnvs(envs) {
  var clonedEnvs = _.clone(envs);
  var escapedEnvs = [];
  if (_.isArray(clonedEnvs)) {
    var envObject = {};
    _.each(clonedEnvs,
      function (clonedEnvObjects) {
        _.each(clonedEnvObjects,
          function (value, key) {
            var envJson = {};
            envJson[key] = value;
            envObject = _.extend(envObject, envJson);
          }
        );
      }
    );
    clonedEnvs = envObject;
  }
  _.each(clonedEnvs,
    function (value, key) {
      if (typeof value === 'string') {
        value = ___escapeEnvironmentVariable(value);
        escapedEnvs.push(util.format('%s="%s"',
          key.replace(/[^A-Za-z0-9_]/g, ''),
          value
        ));
      } else {
        escapedEnvs.push(util.format('%s=%s',
          key.replace(/[^A-Za-z0-9_]/g, ''),
          value
        ));
      }
    }
  );
  return escapedEnvs;
}

function ___escapeEnvironmentVariable(value) {
  if (!value || !_.isString(value)) return value;

  var specialCharacters = ['\\\\', '\\\"', '\\\`', '\\\$'];

  _.each(specialCharacters,
    function (char) {
      var regex = new RegExp(char, 'g');
      value = value.replace(regex, char);
    }
  );

  return value;
}
