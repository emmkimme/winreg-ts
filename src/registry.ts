/* tslint:disable */
/************************************************************************************************************
 * registry.js - contains a wrapper for the REG command under Windows, which provides access to the registry
 *
 * @author Paul Bottin a/k/a FrEsC
 *
 */


/* imports */
import * as util from 'util'
import * as path from 'path'
import { spawn, ChildProcess } from 'child_process'

/* set to console.log for debugging */
var log           = function (msg: string) {}

/* registry hive ids */
,   HKLM          = 'HKLM'
,   HKCU          = 'HKCU'
,   HKCR          = 'HKCR'
,   HKU           = 'HKU'
,   HKCC          = 'HKCC'
,   HIVES         = [ HKLM, HKCU, HKCR, HKU, HKCC ]

/* registry value type ids */
,   REG_SZ        = 'REG_SZ'
,   REG_MULTI_SZ  = 'REG_MULTI_SZ'
,   REG_EXPAND_SZ = 'REG_EXPAND_SZ'
,   REG_DWORD     = 'REG_DWORD'
,   REG_QWORD     = 'REG_QWORD'
,   REG_BINARY    = 'REG_BINARY'
,   REG_NONE      = 'REG_NONE'
,   REG_TYPES     = [ REG_SZ, REG_MULTI_SZ, REG_EXPAND_SZ, REG_DWORD, REG_QWORD, REG_BINARY, REG_NONE ]

/* default registry value name */
,   DEFAULT_VALUE = ''

/* general key pattern */
,   KEY_PATTERN   = /(\\[a-zA-Z0-9_\s]+)*/

/* key path pattern (as returned by REG-cli) */
,   PATH_PATTERN  = /^(HKEY_LOCAL_MACHINE|HKEY_CURRENT_USER|HKEY_CLASSES_ROOT|HKEY_USERS|HKEY_CURRENT_CONFIG)(.*)$/

/* registry item pattern */
,   ITEM_PATTERN  = /^(.*)\s(REG_SZ|REG_MULTI_SZ|REG_EXPAND_SZ|REG_DWORD|REG_QWORD|REG_BINARY|REG_NONE)\s+([^\s].*)$/

, ARCH_X86 = 'x86'
, ARCH_X64 = 'x64'
, ARCHS = [ ARCH_X86, ARCH_X64 ]

/**
 * Creates an Error object that contains the exit code of the REG.EXE process.
 * This contructor is private. Objects of this type are created internally and returned in the <code>err</code> parameters in case the REG.EXE process doesn't exit cleanly.
 *
 * @private
 * @class
 *
 * @param {string} message - the error message
 * @param {number} code - the process exit code
 *
 */
// https://github.com/Microsoft/TypeScript/wiki/Breaking-Changes#extending-built-ins-like-error-array-and-map-may-no-longer-work
class ProcessUncleanExitError extends Error {
    private _code: number;
    constructor(message: string, code: number) {
      super(message);
      this._code = code;

      // Set the prototype explicitly.
      Object.setPrototypeOf(this, ProcessUncleanExitError.prototype);
      Error.captureStackTrace(this, this.constructor); // after initialize properties
    }
  // /**
  //  * The error name.
  //  * @readonly
  //  * @member {string} ProcessUncleanExitError#name
  //  */
  //   get name() { 
  //     return this.name; 
  //   }
  /**
   * The process exit code.
   * @readonly
   * @member {number} ProcessUncleanExitError#code
   */
  get code() { 
    return this._code; 
  }
}

/*
 * Captures stdout/stderr for a child process
 */
interface Output {
  stdout: string;
  stderr: string;
}
function captureOutput(child: ChildProcess) {
  // Use a mutable data structure so we can append as we get new data and have
  // the calling context see the new data
  var output: Output = {'stdout': '', 'stderr': ''};
  child.stdout.on('data', function(data) { output["stdout"] += data.toString(); });
  child.stderr.on('data', function(data) { output["stderr"] += data.toString(); });
  return output;
}


/*
 * Returns an error message containing the stdout/stderr of the child process
 */
function mkErrorMsg(registryCommand: string, code: number, output: Output): Error {
    var stdout = output['stdout'].trim();
    var stderr = output['stderr'].trim();

    var msg = util.format("%s command exited with code %d:\n%s\n%s", registryCommand, code, stdout, stderr);
    return new ProcessUncleanExitError(msg, code);
}


/*
 * Converts x86/x64 to 32/64
 */
function convertArchString(archString: string): string {
  if (archString == 'x64') {
    return '64';
  } else if (archString == 'x86') {
    return '32';
  } else {
    throw new Error('illegal architecture: ' + archString + ' (use x86 or x64)');
  }
}


/*
 * Adds correct architecture to reg args
 */
function pushArch(args: string[], arch?: string) {
  if (arch) {
    args.push('/reg:' + convertArchString(arch));
  }
}

/*
 * Get the path to system's reg.exe. Useful when another reg.exe is added to the PATH
 * Implemented only for Windows
 */
function getRegExePath(utf8: boolean): string {
  if (process.platform === 'win32') {
    if (utf8) {
      return path.join(process.env.windir, 'system32', 'chcp.com') + ' 65001 | ' + path.join(process.env.windir, 'system32', 'reg.exe');
    } else {
      return path.join(process.env.windir, 'system32', 'reg.exe');
    }
  } else {
      return "REG";
  }
}


/**
 * Creates a single registry value record.
 * This contructor is private. Objects of this type are created internally and returned by methods of {@link Registry} objects.
 *
 * @private
 * @class
 *
 * @param {string} host - the hostname
 * @param {string} hive - the hive id
 * @param {string} key - the registry key
 * @param {string} name - the value name
 * @param {string} type - the value type
 * @param {string} value - the value
 * @param {string} arch - the hive architecture ('x86' or 'x64')
 *
 */
export interface RegistryItem {
  /* private members */
  readonly host: string    // hostname
  readonly hive: string;     // registry hive
  readonly key: string     // registry key
  readonly name: string    // property name
  readonly type: string;  // property type
  readonly value: string   // property value
  readonly arch: string    // hive architecture
}

class RegistryItemImpl implements RegistryItem {
  constructor(private _host: string, private _hive: string, private _key: string, private _name: string, private _type: string, private _value: string, private _arch: string) {
  }

  /* getters/setters */

  /**
   * The hostname.
   * @readonly
   * @member {string} RegistryItem#host
   */
  get host(): string {
    return this._host;
  }

  /**
   * The hive id.
   * @readonly
   * @member {string} RegistryItem#hive
   */
  get hive(): string {
    return this._hive;
  }

  /**
   * The registry key.
   * @readonly
   * @member {string} RegistryItem#key
   */
  get key(): string {
    return this._key;
  }

  /**
   * The value name.
   * @readonly
   * @member {string} RegistryItem#name
   */
  get name(): string {
    return this._name;
  }

  /**
   * The value type.
   * @readonly
   * @member {string} RegistryItem#type
   */
  get type(): string {
    return this._type;
  }

  /**
   * The value.
   * @readonly
   * @member {string} RegistryItem#value
   */
  get value(): string {
    return this._value;
  }

  /**
   * The hive architecture.
   * @readonly
   * @member {string} RegistryItem#arch
   */
  get arch(): string {
    return this._arch;
  }
}


/**
 * Creates a registry object, which provides access to a single registry key.
 * Note: This class is returned by a call to ```require('winreg')```.
 *
 * @public
 * @class
 *
 * @param {object} options - the options
 * @param {string=} options.host - the hostname
 * @param {string=} options.hive - the hive id
 * @param {string=} options.key - the registry key
 * @param {string=} options.arch - the optional registry hive architecture ('x86' or 'x64'; only valid on Windows 64 Bit Operating Systems)
 * @param {boolean=} options.utf8 - the optional flag to decode output via utf-8
 *
 * @example
 * var Registry = require('winreg')
 * ,   autoStartCurrentUser = new Registry({
 *       hive: Registry.HKCU,
 *       key:  '\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'
 *     });
 *
 */

export interface Options {
  readonly host?: string    // hostname
  readonly hive?: string;     // registry hive
  readonly key?: string     // registry key
  readonly arch?: string    // hive architecture
  readonly utf8?: boolean   // utf8 flag
}

export /* default */ class Registry {
  /* private members */
/** @internal */
  private _host: string    // hostname
/** @internal */
  private _hive: string;     // registry hive
/** @internal */
  private _key: string     // registry key
/** @internal */
  private _arch: string    // hive architecture
/** @internal */
  private _utf8: boolean   // utf8 flag

  constructor(options?: Options) {
    const _options = options || {};
    this._host = '' + (_options.host || '')    // hostname
    ,   this._hive = (_options.hive || HKLM)  // registry hive
    ,   this._key  = '' + (_options.key  || '')    // registry key
    ,   this._arch = _options.arch || null         // hive architecture
    ,   this._utf8 = _options.utf8 || false        // utf8 flag

  // validate options...
  if (HIVES.indexOf(this._hive) == -1) {
    throw new Error('illegal hive specified.');
  }

  if (!KEY_PATTERN.test(this._key)) {
    throw new Error('illegal key specified.');
  }

  if (this._arch && ARCHS.indexOf(this._arch) == -1) {
    throw new Error('illegal architecture specified (use x86 or x64)');
  }
 }

  /* getters/setters */

  /**
   * The hostname.
   * @readonly
   * @member {string} Registry#host
   */
  get host(): string {
    return this._host;
  }

  /**
   * The hive id.
   * @readonly
   * @member {string} Registry#hive
   */
  get hive(): string {
    return this._hive;
  }

  /**
   * The registry key.
   * @readonly
   * @member {string} Registry#key
   */
  get key(): string {
    return this._key;
  }

  /**
   * The full path to the registry key.
   * @readonly
   * @member {string} Registry#path
   */
  get path(): string {
    return (this._host.length == 0 ? '' : '\\\\' + this._host + '\\') + this._hive + this._key;
  }

  /**
   * The registry hive architecture ('x86' or 'x64').
   * @readonly
   * @member {string} Registry#arch
   */
  get arch(): string {
    return this._arch;
  }

  /**
   * The flag of whether to decode via utf-8.
   * @readonly
   * @member {boolean} Registry#utf8
   */
  get utf8(): boolean {
    return this._utf8;
  }

  /**
   * Creates a new {@link Registry} instance that points to the parent registry key.
   * @readonly
   * @member {Registry} Registry#parent
   */
  get parent(): Registry {
    var i = this._key.lastIndexOf('\\')
    return new Registry({
      host: this.host,
      hive: this.hive,
      key:  (i == -1) ? '' : this._key.substring(0, i),
      arch: this.arch,
      utf8: this.utf8,
    });
  }

/**
 * Registry hive key HKEY_LOCAL_MACHINE.
 * Note: For writing to this hive your program has to run with admin privileges.
 * @type {string}
 */
static readonly HKLM = HKLM;

/**
 * Registry hive key HKEY_CURRENT_USER.
 * @type {string}
 */
static readonly HKCU = HKCU;

/**
 * Registry hive key HKEY_CLASSES_ROOT.
 * Note: For writing to this hive your program has to run with admin privileges.
 * @type {string}
 */
static readonly HKCR = HKCR;

/**
 * Registry hive key HKEY_USERS.
 * Note: For writing to this hive your program has to run with admin privileges.
 * @type {string}
 */
static readonly HKU = HKU;

/**
 * Registry hive key HKEY_CURRENT_CONFIG.
 * Note: For writing to this hive your program has to run with admin privileges.
 * @type {string}
 */
static readonly HKCC = HKCC;

/**
 * Collection of available registry hive keys.
 * @type {array}
 */
static readonly HIVES = HIVES;

/**
 * Registry value type STRING.
 * @type {string}
 */
static readonly REG_SZ = REG_SZ;

/**
 * Registry value type MULTILINE_STRING.
 * @type {string}
 */
static readonly REG_MULTI_SZ = REG_MULTI_SZ;

/**
 * Registry value type EXPANDABLE_STRING.
 * @type {string}
 */
static readonly REG_EXPAND_SZ = REG_EXPAND_SZ;
    
/**
 * Registry value type DOUBLE_WORD.
 * @type {string}
 */
static readonly REG_DWORD = REG_DWORD;
    
/**
 * Registry value type QUAD_WORD.
 * @type {string}
 */
static readonly REG_QWORD = REG_QWORD;

/**
 * Registry value type BINARY.
 * @type {string}
 */
static readonly REG_BINARY = REG_BINARY;

/**
 * Registry value type UNKNOWN.
 * @type {string}
 */
static readonly REG_NONE = REG_NONE;

/**
 * Collection of available registry value types.
 * @type {array}
 */
static readonly REG_TYPES = REG_TYPES;

/**
 * The name of the default value. May be used instead of the empty string literal for better readability.
 * @type {string}
 */
static readonly DEFAULT_VALUE = DEFAULT_VALUE;

/**
 * Retrieve all values from this registry key.
 * @param {valuesCallback} cb - callback function
 * @param {ProcessUncleanExitError=} cb.err - error object or null if successful
 * @param {array=} cb.items - an array of {@link RegistryItem} objects
 * @returns {Registry} this registry key object
 */
values(cb: (err: Error | null, items?: RegistryItem[]) => void): this {

  if (typeof cb !== 'function')
    throw new TypeError('must specify a callback');

  const pathArg = this.utf8 ? `"${this.path}"` : this.path;
  var args = [ 'QUERY', pathArg];

  pushArch(args, this.arch);

  var proc = spawn(getRegExePath(this.utf8), args, {
        cwd: undefined,
        env: process.env,
        stdio: [ 'ignore', 'pipe', 'pipe' ],
        shell: this.utf8
      })
  ,   buffer = ''
  ,   self = this
  ,   error: Error = null // null means no error previously reported.

  var output = captureOutput(proc);

  proc.on('close', function (code) {
    if (error) {
      return;
    } else if (code !== 0) {
      log('process exited with code ' + code);
      cb(mkErrorMsg('QUERY', code, output), null);
    } else {
      var items = []
      ,   result = []
      ,   lines = buffer.split('\n')
      ,   lineNumber = 0

      for (var i = 0, l = lines.length; i < l; i++) {
        var line = lines[i].trim();
        if (line.length > 0) {
          log(line);
          if (lineNumber != 0) {
            items.push(line);
          }
          ++lineNumber;
        }
      }

      for (var i = 0, l = items.length; i < l; i++) {

        var match = ITEM_PATTERN.exec(items[i])
        ,   name
        ,   type
        ,   value

        if (match) {
          name = match[1].trim();
          type = match[2].trim();
          value = match[3];
          result.push(new RegistryItemImpl(self.host, self.hive, self.key, name, type, value, self.arch));
        }
      }

      cb(null, result);

    }
  });

  proc.stdout.on('data', function (data) {
    buffer += data.toString();
  });

  proc.on('error', function(err) {
    error = err;
    cb(err);
  });

  return this;
};

/**
 * Retrieve all subkeys from this registry key.
 * @param {function (err, items)} cb - callback function
 * @param {ProcessUncleanExitError=} cb.err - error object or null if successful
 * @param {array=} cb.items - an array of {@link Registry} objects
 * @returns {Registry} this registry key object
 */
keys(cb: (err: Error | null, items?: Registry[]) => void): this {

  if (typeof cb !== 'function')
    throw new TypeError('must specify a callback');

  const pathArg = this.utf8 ? `"${this.path}"` : this.path;
  var args = [ 'QUERY', pathArg];

  pushArch(args, this.arch);

  var proc = spawn(getRegExePath(this.utf8), args, {
        cwd: undefined,
        env: process.env,
        stdio: [ 'ignore', 'pipe', 'pipe' ],
        shell: this.utf8
      })
  ,   buffer = ''
  ,   self = this
  ,   error: Error = null // null means no error previously reported.

  var output = captureOutput(proc);

  proc.on('close', function (code) {
    if (error) {
      return;
    } else if (code !== 0) {
      log('process exited with code ' + code);
      cb(mkErrorMsg('QUERY', code, output), null);
    }
  });

  proc.stdout.on('data', function (data) {
    buffer += data.toString();
  });

  proc.stdout.on('end', function () {

    var items = []
    ,   result = []
    ,   lines = buffer.split('\n')

    for (var i = 0, l = lines.length; i < l; i++) {
      var line = lines[i].trim();
      if (line.length > 0) {
        log(line);
        items.push(line);
      }
    }

    for (var i = 0, l = items.length; i < l; i++) {

      var match = PATH_PATTERN.exec(items[i])
      // ,   hive
      ,   key

      if (match) {
        // hive = match[1];
        key  = match[2];
        if (key && (key !== self.key)) {
          result.push(new Registry({
            host: self.host,
            hive: self.hive,
            key:  key,
            arch: self.arch
          }));
        }
      }
    }

    cb(null, result);

  });

  proc.on('error', function(err) {
    error = err;
    cb(err);
  });

  return this;
};

/**
 * Gets a named value from this registry key.
 * @param {string} name - the value name, use {@link Registry.DEFAULT_VALUE} or an empty string for the default value
 * @param {function (err, item)} cb - callback function
 * @param {ProcessUncleanExitError=} cb.err - error object or null if successful
 * @param {RegistryItem=} cb.item - the retrieved registry item
 * @returns {Registry} this registry key object
 */
get(name: string, cb: (err: Error | null, item?: RegistryItem) => void): this {

  if (typeof cb !== 'function')
    throw new TypeError('must specify a callback');

  const pathArg = this.utf8 ? `"${this.path}"` : this.path;
  var args = [ 'QUERY', pathArg];
  if (name == '')
    args.push('/ve');
  else
    args = args.concat(['/v', name]);

  pushArch(args, this.arch);

  var proc = spawn(getRegExePath(this.utf8), args, {
        cwd: undefined,
        env: process.env,
        stdio: [ 'ignore', 'pipe', 'pipe' ],
        shell: this.utf8
      })
  ,   buffer = ''
  ,   self = this
  ,   error: Error = null // null means no error previously reported.

  var output = captureOutput(proc);

  proc.on('close', function (code) {
    if (error) {
      return;
    } else if (code !== 0) {
      log('process exited with code ' + code);
      cb(mkErrorMsg('QUERY', code, output), null);
    } else {
      var items = []
      ,   result = null
      ,   lines = buffer.split('\n')
      ,   lineNumber = 0

      for (var i = 0, l = lines.length; i < l; i++) {
        var line = lines[i].trim();
        if (line.length > 0) {
          log(line);
          if (lineNumber != 0) {
             items.push(line);
          }
          ++lineNumber;
        }
      }

      //Get last item - so it works in XP where REG QUERY returns with a header
      var item = items[items.length-1] || ''
      ,   match = ITEM_PATTERN.exec(item)
      ,   name
      ,   type
      ,   value

      if (match) {
        name = match[1].trim();
        type = match[2].trim();
        value = match[3];
        result = new RegistryItemImpl(self.host, self.hive, self.key, name, type, value, self.arch);
      }

      cb(null, result);
    }
  });

  proc.stdout.on('data', function (data) {
    buffer += data.toString();
  });

  proc.on('error', function(err) {
    error = err;
    cb(err);
  });

  return this;
};

/**
 * Sets a named value in this registry key, overwriting an already existing value.
 * @param {string} name - the value name, use {@link Registry.DEFAULT_VALUE} or an empty string for the default value
 * @param {string} type - the value type
 * @param {string} value - the value
 * @param {function (err)} cb - callback function
 * @param {ProcessUncleanExitError=} cb.err - error object or null if successful
 * @returns {Registry} this registry key object
 */
set(name: string, type: string, value: string, cb: (err: Error | null, _ignored_?: any) => void): this {

  if (typeof cb !== 'function')
    throw new TypeError('must specify a callback');

  if (REG_TYPES.indexOf(type) == -1)
    throw Error('illegal type specified.');

  const pathArg = this.utf8 ? `"${this.path}"` : this.path;
  var args = ['ADD', pathArg];
  if (name == '')
    args.push('/ve');
  else
    args = args.concat(['/v', name]);

  args = args.concat(['/t', type, '/d', value, '/f']);

  pushArch(args, this.arch);

  var proc = spawn(getRegExePath(this.utf8), args, {
        cwd: undefined,
        env: process.env,
        stdio: [ 'ignore', 'pipe', 'pipe' ],
        shell: this.utf8
      })
  ,   error: Error = null // null means no error previously reported.

  var output = captureOutput(proc);

  proc.on('close', function (code) {
    if(error) {
      return;
    } else if (code !== 0) {
      log('process exited with code ' + code);
      cb(mkErrorMsg('ADD', code, output), null);
    } else {
      cb(null);
    }
  });

  proc.stdout.on('data', function (data) {
    // simply discard output
    log(''+data);
  });

  proc.on('error', function(err) {
    error = err;
    cb(err);
  });

  return this;
};

/**
 * Remove a named value from this registry key. If name is empty, sets the default value of this key.
 * Note: This key must be already existing.
 * @param {string} name - the value name, use {@link Registry.DEFAULT_VALUE} or an empty string for the default value
 * @param {function (err)} cb - callback function
 * @param {ProcessUncleanExitError=} cb.err - error object or null if successful
 * @returns {Registry} this registry key object
 */
remove (name: string, cb: (err: Error | null, _ignored_?: any) => void): this {

  if (typeof cb !== 'function')
    throw new TypeError('must specify a callback');

  const pathArg = this.utf8 ? `"${this.path}"` : this.path;
  var args = name ? ['DELETE', pathArg, '/f', '/v', name] : ['DELETE', pathArg, '/f', '/ve'];

  pushArch(args, this.arch);

  var proc = spawn(getRegExePath(this.utf8), args, {
        cwd: undefined,
        env: process.env,
        stdio: [ 'ignore', 'pipe', 'pipe' ],
        shell: this.utf8
      })
  ,   error: Error = null // null means no error previously reported.

  var output = captureOutput(proc);

  proc.on('close', function (code) {
    if(error) {
      return;
    } else if (code !== 0) {
      log('process exited with code ' + code);
      cb(mkErrorMsg('DELETE', code, output), null);
    } else {
      cb(null);
    }
  });

  proc.stdout.on('data', function (data) {
    // simply discard output
    log(''+data);
  });

  proc.on('error', function(err) {
    error = err;
    cb(err);
  });

  return this;
};

/**
 * Remove all subkeys and values (including the default value) from this registry key.
 * @param {function (err)} cb - callback function
 * @param {ProcessUncleanExitError=} cb.err - error object or null if successful
 * @returns {Registry} this registry key object
 */
clear(cb: (err: Error | null, _ignored_?: any) => void): this {

  if (typeof cb !== 'function')
    throw new TypeError('must specify a callback');

  const pathArg = this.utf8 ? `"${this.path}"` : this.path;
  var args = ['DELETE', pathArg, '/f', '/va'];

  pushArch(args, this.arch);

  var proc = spawn(getRegExePath(this.utf8), args, {
        cwd: undefined,
        env: process.env,
        stdio: [ 'ignore', 'pipe', 'pipe' ],
        shell: this.utf8
      })
  ,   error: Error = null // null means no error previously reported.

  var output = captureOutput(proc);

  proc.on('close', function (code) {
    if(error) {
      return;
    } else if (code !== 0) {
      log('process exited with code ' + code);
      cb(mkErrorMsg("DELETE", code, output), null);
    } else {
      cb(null);
    }
  });

  proc.stdout.on('data', function (data) {
    // simply discard output
    log(''+data);
  });

  proc.on('error', function(err) {
    error = err;
    cb(err);
  });

  return this;
};

/**
 * Alias for the clear method to keep it backward compatible.
 * @method
 * @deprecated Use {@link Registry#clear} or {@link Registry#destroy} in favour of this method.
 * @param {function (err)} cb - callback function
 * @param {ProcessUncleanExitError=} cb.err - error object or null if successful
 * @returns {Registry} this registry key object
 */
erase(cb: (err: Error | null, _ignored_?: any) => void): this {
    return this.clear(cb);
  }

/**
 * Delete this key and all subkeys from the registry.
 * @param {function (err)} cb - callback function
 * @param {ProcessUncleanExitError=} cb.err - error object or null if successful
 * @returns {Registry} this registry key object
 */
destroy(cb: (err: Error | null, _ignored_?: any) => void): this {

  if (typeof cb !== 'function')
    throw new TypeError('must specify a callback');

  const pathArg = this.utf8 ? `"${this.path}"` : this.path;
  var args = ['DELETE', pathArg, '/f'];

  pushArch(args, this.arch);

  var proc = spawn(getRegExePath(this.utf8), args, {
        cwd: undefined,
        env: process.env,
        stdio: [ 'ignore', 'pipe', 'pipe' ],
        shell: this.utf8
      })
  ,   error: Error = null // null means no error previously reported.

  var output = captureOutput(proc);

  proc.on('close', function (code) {
    if (error) {
      return;
    } else if (code !== 0) {
      log('process exited with code ' + code);
      cb(mkErrorMsg('DELETE', code, output), null);
    } else {
      cb(null);
    }
  });

  proc.stdout.on('data', function (data) {
    // simply discard output
    log(''+data);
  });

  proc.on('error', function(err) {
    error = err;
    cb(err);
  });

  return this;
};

/**
 * Create this registry key. Note that this is a no-op if the key already exists.
 * @param {function (err)} cb - callback function
 * @param {ProcessUncleanExitError=} cb.err - error object or null if successful
 * @returns {Registry} this registry key object
 */
create(cb: (err: Error | null, _ignored_?: any) => void): this {

  if (typeof cb !== 'function')
    throw new TypeError('must specify a callback');

  const pathArg = this.utf8 ? `"${this.path}"` : this.path;
  var args = ['ADD', pathArg, '/f'];

  pushArch(args, this.arch);

  var proc = spawn(getRegExePath(this.utf8), args, {
        cwd: undefined,
        env: process.env,
        stdio: [ 'ignore', 'pipe', 'pipe' ],
        shell: this.utf8
      })
  ,   error: Error = null // null means no error previously reported.

  var output = captureOutput(proc);

  proc.on('close', function (code) {
    if (error) {
      return;
    } else if (code !== 0) {
      log('process exited with code ' + code);
      cb(mkErrorMsg('ADD', code, output), null);
    } else {
      cb(null);
    }
  });

  proc.stdout.on('data', function (data) {
    // simply discard output
    log(''+data);
  });

  proc.on('error', function(err) {
    error = err;
    cb(err);
  });

  return this;
};

/**
 * Checks if this key already exists.
 * @param {function (err, exists)} cb - callback function
 * @param {ProcessUncleanExitError=} cb.err - error object or null if successful
 * @param {boolean=} cb.exists - true if a registry key with this name already exists
 * @returns {Registry} this registry key object
 */
keyExists(cb: (err: Error | null, _ignored_?: any) => void): this {

  this.values(function (err, items) {
    if (err) {
      // process should return with code 1 if key not found
      if (err instanceof ProcessUncleanExitError && err.code == 1) {
        return cb(null, false);
      }
      // other error
      return cb(err);
    }
    cb(null, true);
  });

  return this;
};

/**
 * Checks if a value with the given name already exists within this key.
 * @param {string} name - the value name, use {@link Registry.DEFAULT_VALUE} or an empty string for the default value
 * @param {function (err, exists)} cb - callback function
 * @param {ProcessUncleanExitError=} cb.err - error object or null if successful
 * @param {boolean=} cb.exists - true if a value with the given name was found in this key
 * @returns {Registry} this registry key object
 */
valueExists (name: string, cb: (err: Error | null, _ignored_?: any) => void): this {

  this.get(name, function (err, item) {
    if (err) {
      // process should return with code 1 if value not found
      if (err instanceof ProcessUncleanExitError && err.code == 1) {
        return cb(null, false);
      }
      // other error
      return cb(err);
    }
    cb(null, true);
  });

  return this;
}
}
