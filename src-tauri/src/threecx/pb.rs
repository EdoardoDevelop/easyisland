// A minimal protobuf reader and writer: enough for the 3CX MyPhone messages
// (varints, strings, booleans, nested messages, repeated fields). Field
// numbers come from the web client's own generated code (see myphone.rs).
// Not worth a dependency: the wire format is four rules.

/// One field as it came off the wire.
#[derive(Debug, Clone, PartialEq)]
pub enum Val {
    Varint(u64),
    Bytes(Vec<u8>),
    Fixed64(u64),
    Fixed32(u32),
}

/// A decoded message: its fields in wire order (repeated ones appear several times).
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Msg {
    pub fields: Vec<(u32, Val)>,
}

fn read_varint(b: &[u8], pos: &mut usize) -> Option<u64> {
    let mut out = 0u64;
    for shift in (0..64).step_by(7) {
        let byte = *b.get(*pos)?;
        *pos += 1;
        out |= ((byte & 0x7f) as u64) << shift;
        if byte & 0x80 == 0 {
            return Some(out);
        }
    }
    None
}

impl Msg {
    pub fn decode(b: &[u8]) -> Option<Msg> {
        let mut pos = 0;
        let mut fields = Vec::new();
        while pos < b.len() {
            let key = read_varint(b, &mut pos)?;
            let (no, wire) = ((key >> 3) as u32, key & 7);
            let val = match wire {
                0 => Val::Varint(read_varint(b, &mut pos)?),
                1 => {
                    let v = u64::from_le_bytes(b.get(pos..pos + 8)?.try_into().ok()?);
                    pos += 8;
                    Val::Fixed64(v)
                }
                2 => {
                    let len = read_varint(b, &mut pos)? as usize;
                    let v = b.get(pos..pos.checked_add(len)?)?.to_vec();
                    pos += len;
                    Val::Bytes(v)
                }
                5 => {
                    let v = u32::from_le_bytes(b.get(pos..pos + 4)?.try_into().ok()?);
                    pos += 4;
                    Val::Fixed32(v)
                }
                _ => return None,
            };
            fields.push((no, val));
        }
        Some(Msg { fields })
    }

    fn last(&self, no: u32) -> Option<&Val> {
        self.fields.iter().rev().find(|(n, _)| *n == no).map(|(_, v)| v)
    }

    pub fn int(&self, no: u32) -> Option<i64> {
        match self.last(no)? {
            // int32 is sign-extended to 64 bits on the wire.
            Val::Varint(v) => Some(*v as i64),
            _ => None,
        }
    }

    pub fn bool(&self, no: u32) -> Option<bool> {
        self.int(no).map(|v| v != 0)
    }

    pub fn str(&self, no: u32) -> Option<String> {
        match self.last(no)? {
            Val::Bytes(b) => Some(String::from_utf8_lossy(b).into_owned()),
            _ => None,
        }
    }

    pub fn msg(&self, no: u32) -> Option<Msg> {
        match self.last(no)? {
            Val::Bytes(b) => Msg::decode(b),
            _ => None,
        }
    }

    /// Every occurrence of a repeated message field.
    pub fn msgs(&self, no: u32) -> Vec<Msg> {
        self.fields
            .iter()
            .filter(|(n, _)| *n == no)
            .filter_map(|(_, v)| match v {
                Val::Bytes(b) => Msg::decode(b),
                _ => None,
            })
            .collect()
    }
}

/// Builds a message field by field.
#[derive(Default)]
pub struct Writer {
    pub buf: Vec<u8>,
}

fn put_varint(buf: &mut Vec<u8>, mut v: u64) {
    while v >= 0x80 {
        buf.push((v as u8) | 0x80);
        v >>= 7;
    }
    buf.push(v as u8);
}

impl Writer {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn int(mut self, no: u32, v: i64) -> Self {
        put_varint(&mut self.buf, (no as u64) << 3);
        put_varint(&mut self.buf, v as u64);
        self
    }

    pub fn bool(self, no: u32, v: bool) -> Self {
        self.int(no, v as i64)
    }

    pub fn bytes(mut self, no: u32, v: &[u8]) -> Self {
        put_varint(&mut self.buf, ((no as u64) << 3) | 2);
        put_varint(&mut self.buf, v.len() as u64);
        self.buf.extend_from_slice(v);
        self
    }

    pub fn str(self, no: u32, v: &str) -> Self {
        self.bytes(no, v.as_bytes())
    }

    pub fn msg(self, no: u32, m: Writer) -> Self {
        let inner = m.buf;
        self.bytes(no, &inner)
    }

    pub fn finish(self) -> Vec<u8> {
        self.buf
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip() {
        let inner = Writer::new().str(1, "101").int(2, 300);
        let bytes = Writer::new().int(1, 119).bool(4, true).msg(119, inner).int(5, -1).finish();
        let m = Msg::decode(&bytes).unwrap();
        assert_eq!(m.int(1), Some(119));
        assert_eq!(m.bool(4), Some(true));
        assert_eq!(m.int(5), Some(-1));
        let n = m.msg(119).unwrap();
        assert_eq!(n.str(1).as_deref(), Some("101"));
        assert_eq!(n.int(2), Some(300));
        assert!(m.int(2).is_none());
    }

    #[test]
    fn known_bytes() {
        // From the protobuf spec: field 1 = 150 → 08 96 01; field 2 = "testing".
        let m = Msg::decode(&[0x08, 0x96, 0x01, 0x12, 0x07, b't', b'e', b's', b't', b'i', b'n', b'g']).unwrap();
        assert_eq!(m.int(1), Some(150));
        assert_eq!(m.str(2).as_deref(), Some("testing"));
        assert_eq!(Writer::new().int(1, 150).finish(), vec![0x08, 0x96, 0x01]);
    }

    #[test]
    fn repeated_and_broken() {
        let item = |id: i64| Writer::new().int(2, id);
        let bytes = Writer::new().msg(2, item(1)).msg(2, item(2)).finish();
        let ids: Vec<_> = Msg::decode(&bytes).unwrap().msgs(2).iter().filter_map(|m| m.int(2)).collect();
        assert_eq!(ids, vec![1, 2]);
        // A length running past the end is refused, not a panic.
        assert!(Msg::decode(&[0x12, 0x09, b'a']).is_none());
        assert!(Msg::decode(&[0x80]).is_none());
    }
}
