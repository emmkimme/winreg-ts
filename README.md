#winreg-ts
Basically, it is a raw migration of the original project https://github.com/fresc81/node-winreg to typescript.
We even keep the code formatting and design to ease the comparaison and do not introduce regressions.
We just add utf8 support from https://github.com/eskibear/node-winreg-utf8


# Typescript
```
import { Registry } from 'winreg-ts';

const regKey = new Registry({
    hive: Registry.HKCU,
    key: '\\Software\\Microsoft\\Windows\\CurrentVersion',
    utf8: true
});
```

# Javascript
## Breaking change
### Before (winreg)
```
  // Registry class
  var Registry = require('winreg');
```
### After (winreg-ts)
```
  // Registry class
  var Registry = require('winreg-ts').Registry;
```


# MIT License

Copyright (c) 2020 Emmanuel Kimmerlin

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.