package scraper

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"sort"
	"strconv"
)

const maxJSONDepth = 64

type jsonPair struct {
	key   string
	value *jsonNode
}

type jsonNode struct {
	object  []jsonPair
	array   []*jsonNode
	string  *string
	number  json.Number
	boolean *bool
	null    bool
}

func decodeOrderedJSON(raw []byte) (*jsonNode, error) {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	node, err := decodeJSONToken(decoder, 0)
	if err != nil {
		return nil, err
	}
	if token, err := decoder.Token(); err != io.EOF {
		if err == nil {
			return nil, fmt.Errorf("unexpected trailing JSON token %v", token)
		}
		return nil, err
	}
	return node, nil
}

func decodeJSONToken(decoder *json.Decoder, depth int) (*jsonNode, error) {
	if depth > maxJSONDepth {
		return nil, fmt.Errorf("JSON nesting exceeds %d", maxJSONDepth)
	}
	token, err := decoder.Token()
	if err != nil {
		return nil, err
	}
	switch value := token.(type) {
	case json.Delim:
		switch value {
		case '{':
			node := &jsonNode{object: []jsonPair{}}
			positions := make(map[string]int)
			for decoder.More() {
				keyToken, err := decoder.Token()
				if err != nil {
					return nil, err
				}
				key, ok := keyToken.(string)
				if !ok {
					return nil, fmt.Errorf("object key is not a string")
				}
				child, err := decodeJSONToken(decoder, depth+1)
				if err != nil {
					return nil, err
				}
				// JSON.parse keeps the last value of a duplicate property without
				// moving its original enumeration position. Avoid a quadratic scan.
				if index, exists := positions[key]; exists {
					node.object[index].value = child
				} else {
					positions[key] = len(node.object)
					node.object = append(node.object, jsonPair{key: key, value: child})
				}
			}
			if _, err := decoder.Token(); err != nil {
				return nil, err
			}
			return node, nil
		case '[':
			node := &jsonNode{array: []*jsonNode{}}
			for decoder.More() {
				child, err := decodeJSONToken(decoder, depth+1)
				if err != nil {
					return nil, err
				}
				node.array = append(node.array, child)
			}
			if _, err := decoder.Token(); err != nil {
				return nil, err
			}
			return node, nil
		}
	case string:
		return &jsonNode{string: &value}, nil
	case json.Number:
		return &jsonNode{number: value}, nil
	case bool:
		return &jsonNode{boolean: &value}, nil
	case nil:
		return &jsonNode{null: true}, nil
	}
	return nil, fmt.Errorf("unsupported JSON token")
}

func (node *jsonNode) get(key string) *jsonNode {
	if node == nil {
		return nil
	}
	for _, pair := range node.object {
		if pair.key == key {
			return pair.value
		}
	}
	return nil
}

func (node *jsonNode) text() (string, bool) {
	if node == nil || node.string == nil {
		return "", false
	}
	return *node.string, true
}

func (node *jsonNode) objectValues() []*jsonNode {
	if node == nil || node.object == nil {
		return nil
	}
	integerPairs := make([]struct {
		index uint64
		value *jsonNode
	}, 0)
	other := make([]*jsonNode, 0, len(node.object))
	for _, pair := range node.object {
		if index, ok := jsArrayIndex(pair.key); ok {
			integerPairs = append(integerPairs, struct {
				index uint64
				value *jsonNode
			}{index: index, value: pair.value})
		} else {
			other = append(other, pair.value)
		}
	}
	sort.SliceStable(integerPairs, func(i, j int) bool { return integerPairs[i].index < integerPairs[j].index })
	values := make([]*jsonNode, 0, len(node.object))
	for _, pair := range integerPairs {
		values = append(values, pair.value)
	}
	return append(values, other...)
}

func jsArrayIndex(key string) (uint64, bool) {
	if key == "" || (len(key) > 1 && key[0] == '0') {
		return 0, false
	}
	index, err := strconv.ParseUint(key, 10, 32)
	if err != nil || index == 1<<32-1 || strconv.FormatUint(index, 10) != key {
		return 0, false
	}
	return index, true
}
