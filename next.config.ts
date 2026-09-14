import type {NextConfig} from 'next';

const config:NextConfig={
  devIndicators:false,
  output:'standalone',
  async headers(){
    return [{source:'/',headers:[{key:'Cache-Control',value:'no-store, max-age=0'}]}];
  },
};

export default config;
