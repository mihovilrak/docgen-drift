#!/usr/bin/env node

import { cac } from "cac";

import { VERSION } from "./index.js";

const cli = cac("docgen");

cli.help();
cli.version(VERSION);
cli.parse();
