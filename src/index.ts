import process from 'node:process'
import { run } from './run'

run().catch(() => process.exit(1))
