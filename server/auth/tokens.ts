import { randomBytes, randomInt } from 'node:crypto'

export const WORDS = [
  'BLUE', 'RED', 'GOLD', 'FOX', 'WOLF', 'BEAR', 'HAWK', 'STAR', 'MOON', 'RAIN',
  'LEAF', 'ROCK', 'WAVE', 'FIRE', 'SNOW', 'PEAK', 'LAKE', 'ROSE', 'IRON', 'JADE',
  'CROW', 'DOVE', 'SWAN', 'TREE', 'PINE', 'MINT', 'SAGE', 'LIME', 'SAND', 'MIST',
  'WIND', 'DUSK', 'DAWN', 'GLOW', 'RUST', 'OPAL', 'REED', 'SILK', 'CORD', 'BOLT',
  'TWIG', 'MOSS', 'FERN', 'VINE', 'SEED', 'BULB', 'ROOT', 'BARK', 'THORN', 'PETAL',
  'CREST', 'CLAW', 'FANG', 'HOOF', 'TAIL', 'WING', 'BEAK', 'HORN', 'MANE', 'SPINE',
  'ASH', 'DUNE', 'POOL', 'GLEN', 'VALE', 'DELL', 'KNOLL', 'GLADE', 'PLAIN', 'SLOPE',
  'OTTER', 'BADGER', 'STOAT', 'NEWT', 'TOAD', 'HERON', 'EAGLE', 'OWL', 'ROOK', 'LARK',
  'BLAZE', 'EMBER', 'TORCH', 'LANTERN', 'CANDLE', 'SPARK', 'FLARE', 'GLEAM', 'GRIN', 'SMIRK',
  'ZEBRA', 'LYNX', 'PUMA', 'COBRA', 'RAVEN', 'SALMON', 'TERN', 'DRAKE', 'STAG', 'ELK',
]

export function generateToken(): string {
  return randomBytes(16).toString('hex')
}

export function generateRoomCode(): string {
  const wordA = WORDS[randomInt(WORDS.length)]
  const wordB = WORDS[randomInt(WORDS.length)]
  const digits = String(randomInt(0, 1000)).padStart(3, '0')
  return `${wordA}-${wordB}-${digits}`
}
