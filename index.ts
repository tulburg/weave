import {CalleeFunction, FernConfiguration} from "./types";
import * as express from 'express';
import * as core from "express-serve-static-core";
import http from 'http';
import {type} from "./src/util";
const log = (...msg: any[]) => {
  console.log('['+ new Date().toLocaleString() +'] :: ', ...msg);
}

declare module 'express-serve-static-core' {
  export interface Response {
    sendOk: (json: {[key: string]: any}) => void;
    sendError: (code: number, message: string, stack?: string | any) => void;
  }
}

export class Fern {
  options: FernConfiguration;
  private app: any; 
  response?: core.Response;
  request?: core.Request;
  callee: [CalleeFunction];
  registry: {[key: string]: [CalleeFunction]};

  nextDb: any[] = [] as any;
  nextBody: {[key: string]: any} = {} as any;
  nextStore: {[key: string]: any} = {} as any;
  nextHeader: {[key: string]: any} = {} as any;
  nextParams: {[key: string]: any} = {} as any;
  nextMethod: 'post' | 'get' | 'delete' = 'get';

  defaultOptions = {
    useJSON: true,
    driver: 'express'
  }
  use: any;

  constructor(options: FernConfiguration) {
    this.options = Object.assign(this.defaultOptions, options);
    if(this.options.driver === 'express') {
      this.app = express.default();
      this.use = this.app.use;
      this.app.response.sendOk = function (json: {[key: string]: any}) {
        log('Send => ', 200);
        json.status = 200;
        this.status(200).json(json);
      };

      this.app.response.sendError = function (code: number, message: string, stack?: string) {
        const json: any = stack ? {message: message, stack: stack} : {message: message};
        log('Send => ', code, message);
        json.status = code;
        this.status(code).json(json);
      };

      // if(this.options.useJSON) this.app.use(express.json({ limit: '15mb'}));
      this.app.use(express.json({ limit: '15mb'}));
      const server = http.createServer(this.app);
      server.listen(8080);
      log('>> Server is listening at 8080');
    }
    this.callee = [] as any;
    this.registry = {} as any;
  }

  endpoint(path: string, method: 'POST' | 'GET' | 'DELETE'): Fern {
    method = method.toLowerCase() as any;

    this.registry[method + ':' + path] = [] as any
    this.callee = this.registry[method + ':' + path];
    this.app[method](path, (req: any, res: any) => {
      this.request = req;
      this.response = res;
      let index = 0;
      this.nextBody = undefined as any;
      this.nextMethod = method.toUpperCase() as any;
      this.nextParams = undefined as any;
      this.nextDb = undefined as any;
      this.nextStore = undefined as any;
      this.nextHeader = undefined as any;
      const callee = this.registry[method + ':' + path];
      const callNext = () => {
        if(index < callee.length) {
          const fn = callee[index];
          const res = fn(this);
          if(type(res) === 'promise') {
            (<Promise<boolean>>res).then((v: boolean | { code: number, message?: string, stack?: any }) => {
              if(v === true) {
                index++;
                callNext();
              }else {
                if(!v) this.response?.sendError(500, 'FernError: Function failed');
                else this.response?.sendError(v.code, v.message as string, v.stack);
              }
            })
          } else if(res === true) {
            index++;
            callNext();
          } else {
            const result = res as { code: number, message?: string, stack?: any };
            if(!res) this.response?.sendError(500, 'FernError: Function failed');
            else this.response?.sendError(result.code, result.message as string, result.stack);
          };   
        }
      }
      callNext();
    });
    this.callee.push((fern: Fern) => {
      fern.nextMethod = method as any;
      return true;
    });
    return this;
  }

  mapBody(keys: string[]) {
    const fn: CalleeFunction = () => {
      if(!this.request?.body) return {
        code: 400, message: 'Invalid request'
      }
      let checks = 0;
      keys.forEach(k => {
        if(this.request?.body.hasOwnProperty(k)) {
          this.nextBody = this.nextBody || {} as any;
          this.nextBody[k] = this.request?.body[k];
          checks++;
        }
      });
      if(checks === keys.length - 1) true;
      return { code: 403, message: 'Bad Request'}
    }
    this.callee.push(fn);
    return this;
  }

  useBody(callback?: CalleeFunction) {
    const fn = () => {
      if(callback) return callback(this);
      else return true;
    }
    this.callee.push(fn as CalleeFunction);
    return this;
  }

  // mapHeader
  // useHeader
  // useStore

  mapDB (...args: any[]) {
    const fn: CalleeFunction = () => {
      this.nextDb = args;
      return true;
    }
    this.callee.push(fn);
    return this; 
  }

  useDB(pFn: (fern: Fern) => Promise<boolean>) {
    const fn: CalleeFunction = async () => {
      let res = false;
      try {
        res = await pFn(this);
      }catch(e) { log(e) };
      return res;
    }
    this.callee.push(fn);
    return this;
  }

  // useAuthentication() {
  //   const fn: CalleeFunction = () => {
  //     const headerToken = this.request?.headers.authorization;
  //     if(headerToken && headerToken.slice(0, 6) === 'Bearer') {
  //       let token = headerToken.replace('Bearer ', '');
  //       if(token.trim().length === 0) {
  //         return { code: 401, message: 'Authorization failed' };
  //       }
  //       jwt.verify(token, process.env.jwtKey, function(err: any, data: TokenData) {
  //         if(err || data.iss !== 'x-plane.app.server') {
  //           return { code: 401, message: 'Unauthorized' };
  //         }else if(new Date(data.expiry) < new Date()) {
  //           return { code: 400, message: 'Invalid Token' };
  //         }else return true;
  //       });
  //     }else {
  //       return { code: 403, message: 'Authorization failed' }
  //     }
  //     return false;
  //   }
  //   
  //   this.callee.push(fn);
  //   return this;
  // }

  send(data: string | { message: string } | any) {
    const fn: CalleeFunction = () => {
      this.response?.sendOk(data);
      return true;
    };
    this.callee.push(fn);
  }
 
  //
  // useDB(callable: (map: string[] | [string[]], success: any, fail: any) => any, map: string[] | [string[]], success: any, fail: any) {
  //   callable(map, success, fail);
  // }
  //
  // mapInputs(callable: Function, field: [string]) {
  //
  // }

  
}

// Other Database functions for useDB =>
// CheckIfExists
// Create
// CreateOrUpdate
// Delete
// Fetch
// FetchWhere
//


export default Fern;
